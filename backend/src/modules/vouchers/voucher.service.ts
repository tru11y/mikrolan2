import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import {
  AuditAction,
  ManagementMode,
  Prisma,
  RemotePeerStatus,
  VoucherBatchStatus,
  VoucherStatus,
} from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { RemoteRouterService } from '../remote-access/remote-router.service';
import {
  addHotspotUser,
  ensureUserProfile,
  removeHotspotUser,
} from '../../common/routeros/hotspot.ops';
import { getTenantContext } from '../../common/context/tenant-context';
import type {
  ConfirmVouchersDto,
  GenerateVouchersDto,
} from './dto/voucher.schemas';

// No ambiguous glyphs (0/O, 1/I) — codes get read aloud and typed by hand.
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const CODE_LEN = 8;

const VOUCHER_PUBLIC = {
  id: true,
  code: true,
  password: true,
  status: true,
  planId: true,
  routerId: true,
  batchId: true,
  expiresAt: true,
  usedAt: true,
  createdAt: true,
} satisfies Prisma.VoucherSelect;

// RouterOS push parameters — returned to the client for LOCAL (free) routers so
// the mobile app can push the users over the LAN itself (no tunnel needed).
export interface VoucherPushParams {
  userProfile: string;
  rateLimit?: string;
  limitUptime: string;
  limitBytesTotal?: number;
  comment: string;
}

@Injectable()
export class VoucherService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly remote: RemoteRouterService,
  ) {}

  async generate(routerId: string, dto: GenerateVouchersDto) {
    const router = await this.prisma.router.findFirst({
      where: { id: routerId, deletedAt: null },
      select: { id: true, mode: true },
    });
    if (!router) throw new NotFoundException('Router not found');

    const plan = await this.prisma.plan.findFirst({
      where: { id: dto.planId, deletedAt: null },
      select: {
        id: true,
        userProfile: true,
        durationMinutes: true,
        dataLimitMb: true,
        downloadKbps: true,
        uploadKbps: true,
      },
    });
    if (!plan) throw new NotFoundException('Plan not found');

    const ctx = getTenantContext();
    const tenantId = ctx?.tenantId;
    if (!tenantId) throw new BadRequestException('Contexte tenant manquant');

    const codes = await this.uniqueCodes(dto.quantity);
    const push: VoucherPushParams = {
      userProfile: plan.userProfile,
      // RouterOS rate-limit = "rx/tx" (client upload/download). Only when both set.
      rateLimit:
        plan.uploadKbps && plan.downloadKbps
          ? `${plan.uploadKbps}k/${plan.downloadKbps}k`
          : undefined,
      limitUptime: `${plan.durationMinutes}m`,
      limitBytesTotal: plan.dataLimitMb
        ? plan.dataLimitMb * 1024 * 1024
        : undefined,
      comment: '', // filled per batch below
    };

    const batch = await this.prisma.voucherBatch.create({
      data: {
        tenantId,
        planId: plan.id,
        routerId,
        quantity: dto.quantity,
        status: VoucherBatchStatus.GENERATING,
        createdById: ctx.userId,
      } satisfies Prisma.VoucherBatchUncheckedCreateInput,
      select: { id: true },
    });
    push.comment = `mikrolan:${batch.id}`;

    await this.prisma.voucher.createMany({
      data: codes.map((code) => ({
        tenantId,
        planId: plan.id,
        routerId,
        batchId: batch.id,
        code,
        password: code,
        createdById: ctx.userId,
      })),
    });

    // REMOTE router with an active tunnel → the server pushes over WireGuard.
    // LOCAL (free) router → hand the codes + push params to the client, which
    // writes them to the router over the LAN and confirms back.
    const peer =
      router.mode === ManagementMode.REMOTE
        ? await this.prisma.remotePeer.findFirst({
            where: { routerId, status: RemotePeerStatus.ACTIVE },
            select: { id: true },
          })
        : null;

    if (peer) {
      try {
        await this.remote.run(routerId, async (client) => {
          await ensureUserProfile(client, plan);
          for (const code of codes) {
            const mikrotikId = await addHotspotUser(client, {
              code,
              password: code,
              profile: plan.userProfile,
              limitUptime: push.limitUptime,
              limitBytesTotal: push.limitBytesTotal,
              comment: push.comment,
            });
            if (mikrotikId) {
              await this.prisma.voucher.updateMany({
                where: { batchId: batch.id, code },
                data: { mikrotikId },
              });
            }
          }
        });
      } catch (e) {
        await this.prisma.voucherBatch.update({
          where: { id: batch.id },
          data: { status: VoucherBatchStatus.FAILED },
        });
        throw e;
      }
      await this.completeBatch(batch.id, codes.length);
    }

    const vouchers = await this.prisma.voucher.findMany({
      where: { batchId: batch.id },
      select: VOUCHER_PUBLIC,
      orderBy: { createdAt: 'asc' },
    });
    return {
      batchId: batch.id,
      pushedByServer: Boolean(peer),
      push: peer ? undefined : push,
      vouchers,
    };
  }

  /** LOCAL path: the client pushed the users over the LAN and reports the ids. */
  async confirmPush(routerId: string, dto: ConfirmVouchersDto) {
    for (const item of dto.items) {
      await this.prisma.voucher.updateMany({
        where: { id: item.id, routerId },
        data: { mikrotikId: item.mikrotikId },
      });
    }
    await this.completeBatch(dto.batchId, dto.items.length);
    await this.audit(AuditAction.CREATE, dto.batchId, {
      routerId,
      confirmed: dto.items.length,
      via: 'lan',
    });
    return { confirmed: dto.items.length };
  }

  private async completeBatch(batchId: string, generated: number) {
    await this.prisma.voucherBatch.update({
      where: { id: batchId },
      data: {
        status: VoucherBatchStatus.COMPLETED,
        generated,
        completedAt: new Date(),
      },
    });
  }

  list(routerId?: string, status?: VoucherStatus, batchId?: string) {
    return this.prisma.voucher.findMany({
      where: {
        ...(routerId ? { routerId } : {}),
        ...(status ? { status } : {}),
        ...(batchId ? { batchId } : {}),
      },
      select: VOUCHER_PUBLIC,
      orderBy: { createdAt: 'desc' },
      take: 500,
    });
  }

  listBatches(routerId?: string) {
    return this.prisma.voucherBatch.findMany({
      where: routerId ? { routerId } : {},
      select: {
        id: true,
        planId: true,
        routerId: true,
        quantity: true,
        generated: true,
        status: true,
        createdAt: true,
        completedAt: true,
      },
      orderBy: { createdAt: 'desc' },
      take: 200,
    });
  }

  async revoke(id: string) {
    const voucher = await this.prisma.voucher.findFirst({
      where: { id },
      select: {
        id: true,
        routerId: true,
        mikrotikId: true,
        status: true,
        router: { select: { mode: true } },
      },
    });
    if (!voucher) throw new NotFoundException('Voucher not found');
    if (voucher.status === VoucherStatus.REVOKED) {
      throw new BadRequestException('Voucher déjà révoqué');
    }

    // Remove from the router only over the tunnel (REMOTE). For LOCAL routers the
    // client removes it over the LAN; DB state stays authoritative regardless.
    if (voucher.mikrotikId && voucher.router.mode === ManagementMode.REMOTE) {
      try {
        await this.remote.run(voucher.routerId, (client) =>
          removeHotspotUser(client, voucher.mikrotikId as string),
        );
      } catch {
        // router unreachable — keep the DB state authoritative
      }
    }

    await this.prisma.voucher.updateMany({
      where: { id },
      data: { status: VoucherStatus.REVOKED, revokedAt: new Date() },
    });
    await this.audit(AuditAction.REVOKE, id, {});
    return { revoked: true };
  }

  private async uniqueCodes(quantity: number): Promise<string[]> {
    const set = new Set<string>();
    while (set.size < quantity) set.add(this.genCode());
    let codes = [...set];

    const existing = await this.prisma.voucher.findMany({
      where: { code: { in: codes } },
      select: { code: true },
    });
    if (existing.length) {
      const taken = new Set(existing.map((v) => v.code));
      codes = codes.filter((c) => !taken.has(c));
      while (codes.length < quantity) {
        const c = this.genCode();
        if (!taken.has(c) && !codes.includes(c)) codes.push(c);
      }
    }
    return codes;
  }

  private genCode(): string {
    const b = randomBytes(CODE_LEN);
    let s = '';
    for (let i = 0; i < CODE_LEN; i += 1) s += ALPHABET[b[i] % ALPHABET.length];
    return s;
  }

  private async audit(
    action: AuditAction,
    entityId: string,
    metadata: Prisma.InputJsonValue,
  ): Promise<void> {
    const ctx = getTenantContext();
    if (!ctx) return;
    try {
      await this.prisma.auditLog.create({
        data: {
          tenantId: ctx.tenantId,
          userId: ctx.userId,
          action,
          entityType: 'Voucher',
          entityId,
          metadata,
        },
      });
    } catch {
      // append-only, best-effort
    }
  }
}
