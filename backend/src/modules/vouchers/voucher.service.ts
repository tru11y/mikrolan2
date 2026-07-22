import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import {
  AuditAction,
  Prisma,
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
import type { GenerateVouchersDto } from './dto/voucher.schemas';

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

@Injectable()
export class VoucherService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly remote: RemoteRouterService,
  ) {}

  async generate(routerId: string, dto: GenerateVouchersDto) {
    const router = await this.prisma.router.findFirst({
      where: { id: routerId, deletedAt: null },
      select: { id: true },
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
    const limitUptime = `${plan.durationMinutes}m`;
    const limitBytesTotal = plan.dataLimitMb
      ? plan.dataLimitMb * 1024 * 1024
      : undefined;

    // Persist as a GENERATING batch first, then push to the router. On push
    // failure the batch is marked FAILED (codes stay in DB, none on the router).
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

    try {
      await this.remote.run(routerId, async (client) => {
        await ensureUserProfile(client, plan);
        for (const code of codes) {
          const mikrotikId = await addHotspotUser(client, {
            code,
            password: code,
            profile: plan.userProfile,
            limitUptime,
            limitBytesTotal,
            comment: `mikrolan:${batch.id}`,
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

    await this.prisma.voucherBatch.update({
      where: { id: batch.id },
      data: {
        status: VoucherBatchStatus.COMPLETED,
        generated: codes.length,
        completedAt: new Date(),
      },
    });
    await this.audit(AuditAction.CREATE, batch.id, {
      planId: plan.id,
      routerId,
      quantity: codes.length,
    });

    return this.prisma.voucher.findMany({
      where: { batchId: batch.id },
      select: VOUCHER_PUBLIC,
      orderBy: { createdAt: 'asc' },
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
      select: { id: true, routerId: true, mikrotikId: true, status: true },
    });
    if (!voucher) throw new NotFoundException('Voucher not found');
    if (voucher.status === VoucherStatus.REVOKED) {
      throw new BadRequestException('Voucher déjà révoqué');
    }

    if (voucher.mikrotikId) {
      // Best-effort removal from the router; DB revocation proceeds regardless.
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
