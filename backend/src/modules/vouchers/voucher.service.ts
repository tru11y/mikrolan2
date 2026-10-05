import {
  HttpStatus,
  Injectable,
  Logger,
} from '@nestjs/common';
import { BusinessException } from '../../common/exceptions/business.exception';
import { ErrorCode } from '../../common/error-codes';
import { randomBytes } from 'node:crypto';
import {
  AuditAction,
  ManagementMode,
  Prisma,
  RemotePeerStatus,
  EventOutcome,
  SessionStatus,
  VoucherBatchStatus,
  VoucherStatus,
} from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { RemoteRouterService } from '../remote-access/remote-router.service';
import { SubscriptionsService } from '../subscriptions/subscriptions.service';
import { EventLogService, describeFailure } from '../events/event-log.service';
import {
  addHotspotUser,
  ensureUserProfile,
  removeHotspotUser,
} from '../../common/routeros/hotspot.ops';
import { getTenantContext } from '../../common/context/tenant-context';
import type {
  ConfirmVouchersDto,
  ReportPushFailureDto,
  GenerateVouchersDto,
  VerifyVoucherDto,
} from './dto/voucher.schemas';

// No ambiguous glyphs (0/O, 1/I) — codes get read aloud and typed by hand.
const ALPHANUMERIC = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const NUMERIC = '0123456789';

type CodeFormatOptions = {
  codePrefix: string | null;
  codeLength: number;
  codeFormat: 'ALPHANUMERIC' | 'NUMERIC';
};

export interface BatchDeletionPreview {
  batchId: string | null;
  total: number;
  /** Jamais utilisés (GENERATED) ou déjà annulés (REVOKED) — supprimables. */
  eligible: number;
  /**
   * Déjà activés (ACTIVE) mais sans Session ouverte en ce moment — conservés
   * pour ne jamais perdre de revenu déjà comptabilisé, pas parce qu'un client
   * est connecté.
   */
  keptForHistory: number;
  /** ACTIVE avec une Session actuellement ouverte — client connecté maintenant. */
  connectedNow: number;
}

export interface BulkDeletionResult {
  analyzed: number;
  deleted: number;
  /** = keptForHistory + connectedNow ci-dessous. */
  protectedActive: number;
  keptForHistory: number;
  connectedNow: number;
  routerCleanupFailed: number;
}

const VOUCHER_PUBLIC = {
  id: true,
  code: true,
  password: true,
  // Lu uniquement pour décider `provisioned` côté serveur : jamais renvoyé tel quel.
  mikrotikId: true,
  status: true,
  planId: true,
  routerId: true,
  batchId: true,
  expiresAt: true,
  usedAt: true,
  createdAt: true,
} satisfies Prisma.VoucherSelect;

/**
 * Règle métier : un voucher n'est distribuable que si MikroLan a la preuve qu'il
 * existe côté RouterOS, c.-à-d. `mikrotikId` renseigné (REMOTE : retour de
 * /ip/hotspot/user/add ; LOCAL : confirmPush du mobile). Une ligne en base ou
 * le statut GENERATED ne prouvent rien.
 */
export function isProvisioned(v: { mikrotikId?: string | null }): boolean {
  return typeof v.mikrotikId === 'string' && v.mikrotikId.length > 0;
}

/** Filtre SQL équivalent à `isProvisioned` (la chaîne vide est un id invalide). */
const PROVISIONED_WHERE = {
  NOT: [{ mikrotikId: null }, { mikrotikId: '' }],
} satisfies Prisma.VoucherWhereInput;

/**
 * État métier d'un ticket pour l'écran « Vérifier un ticket », calculé uniquement depuis la base
 * (aucun appel RouterOS). `Voucher.expiresAt` n'est jamais écrit et `limit-uptime` compte le temps
 * de connexion cumulé : on ne déduit donc JAMAIS « expiré » d'une date, seulement du statut stocké.
 */
export type TicketState =
  | 'AVAILABLE' // provisionné, jamais utilisé
  | 'IN_USE' // une session est ouverte maintenant
  | 'USED' // déjà utilisé, pas connecté actuellement
  | 'ENDED' // statut USED (consommé)
  | 'EXPIRED' // statut EXPIRED
  | 'REVOKED'
  | 'UNAVAILABLE'; // non provisionné sur le routeur

export function ticketState(v: {
  status: VoucherStatus;
  provisioned: boolean;
  session?: { status: SessionStatus } | null;
}): TicketState {
  if (v.status === VoucherStatus.REVOKED) return 'REVOKED';
  if (!v.provisioned) return 'UNAVAILABLE';
  if (v.status === VoucherStatus.EXPIRED) return 'EXPIRED';
  if (v.status === VoucherStatus.USED) return 'ENDED';
  if (v.status === VoucherStatus.ACTIVE) {
    return v.session?.status === SessionStatus.ACTIVE ? 'IN_USE' : 'USED';
  }
  return 'AVAILABLE';
}

/** Projection publique : `provisioned` est décidé ici, le mikrotikId n'est jamais exposé. */
function toPublicVoucher<T extends { mikrotikId: string | null }>(
  v: T,
): Omit<T, 'mikrotikId'> & { provisioned: boolean } {
  const { mikrotikId, ...rest } = v;
  return { ...rest, provisioned: isProvisioned({ mikrotikId }) };
}

// RouterOS push parameters — returned to the client for LOCAL (free) routers so
// the mobile app can push the users over the LAN itself (no tunnel needed).
export interface VoucherPushParams {
  userProfile: string;
  rateLimit?: string;
  sharedUsers?: number;
  limitUptime: string;
  limitBytesTotal?: number;
  comment: string;
}

@Injectable()
export class VoucherService {
  private readonly logger = new Logger(VoucherService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly remote: RemoteRouterService,
    private readonly subscriptions: SubscriptionsService,
    private readonly eventLog: EventLogService,
  ) {}

  async generate(routerId: string, dto: GenerateVouchersDto) {
    try {
      return await this.doGenerate(routerId, dto);
    } catch (err) {
      await this.eventLog.failure(AuditAction.CREATE, 'VoucherBatch', routerId, err, {
        routerId,
        quantity: dto.quantity,
        stage: 'generate',
      });
      throw err;
    }
  }

  private async doGenerate(routerId: string, dto: GenerateVouchersDto) {
    const router = await this.prisma.router.findFirst({
      where: { id: routerId, deletedAt: null },
      select: { id: true, mode: true },
    });
    if (!router) throw new BusinessException(HttpStatus.NOT_FOUND, ErrorCode.ROUTER_NOT_FOUND, 'Routeur introuvable — il a peut-être été supprimé.');

    const plan = await this.prisma.plan.findFirst({
      where: { id: dto.planId, routerId, deletedAt: null },
      select: {
        id: true,
        userProfile: true,
        durationMinutes: true,
        dataLimitMb: true,
        downloadKbps: true,
        uploadKbps: true,
        sharedUsers: true,
        codePrefix: true,
        codeLength: true,
        codeFormat: true,
      },
    });
    if (!plan) throw new BusinessException(HttpStatus.NOT_FOUND, ErrorCode.PLAN_NOT_FOUND, 'Forfait introuvable.');

    const ctx = getTenantContext();
    const tenantId = ctx?.tenantId;
    if (!tenantId) throw new BusinessException(HttpStatus.BAD_REQUEST, ErrorCode.TENANT_CONTEXT_MISSING, 'Contexte tenant manquant');

    await this.subscriptions.assertVoucherLimit(tenantId);

    const codes = await this.uniqueCodes(dto.quantity, {
      codePrefix: plan.codePrefix,
      codeLength: plan.codeLength,
      codeFormat: plan.codeFormat,
    });
    const push: VoucherPushParams = {
      userProfile: plan.userProfile,
      // RouterOS rate-limit = "rx/tx" (client upload/download). Only when both set.
      rateLimit:
        plan.uploadKbps && plan.downloadKbps
          ? `${plan.uploadKbps}k/${plan.downloadKbps}k`
          : undefined,
      sharedUsers: plan.sharedUsers,
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
      select: { id: true, seq: true },
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
      let pushedCount = 0;
      try {
        await this.remote.run(
          routerId,
          async (client) => {
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
              pushedCount++;
            }
          },
          { timeoutMs: Math.max(60_000, codes.length * 3000) },
        );
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : String(err);
        this.logger.error({
          errorCode: 'VOUCHER_PUSH_FAILED',
          batchId: batch.id,
          routerId,
          pushedCount,
          totalCount: codes.length,
          error: errorMsg,
        });
        const failMeta = { routerId, pushedCount, totalCount: codes.length };
        if (pushedCount > 0) {
          await this.eventLog.emit({
            action: AuditAction.CREATE,
            entityType: 'VoucherBatch',
            entityId: batch.id,
            outcome: EventOutcome.PARTIAL_SUCCESS,
            metadata: { ...failMeta, ...describeFailure(err), pushErrorCode: ErrorCode.VOUCHER_PUSH_FAILED },
          });
        } else {
          await this.eventLog.failure(AuditAction.CREATE, 'VoucherBatch', batch.id, err, {
            ...failMeta,
            pushErrorCode: ErrorCode.VOUCHER_PUSH_FAILED,
          });
        }
        if (pushedCount > 0) {
          await this.prisma.voucherBatch.update({
            where: { id: batch.id },
            data: {
              status: VoucherBatchStatus.PARTIAL_SUCCESS,
              generated: pushedCount,
              completedAt: new Date(),
            },
          });
        } else {
          await this.prisma.voucherBatch.update({
            where: { id: batch.id },
            data: { status: VoucherBatchStatus.FAILED },
          });
        }
      }
      if (pushedCount === codes.length) {
        await this.completeBatch(batch.id, codes.length);
        await this.eventLog.success(AuditAction.CREATE, 'VoucherBatch', batch.id, {
          routerId,
          pushedCount,
          totalCount: codes.length,
          via: 'tunnel',
        });
      }
    } else {
      await this.eventLog.success(AuditAction.CREATE, 'VoucherBatch', batch.id, {
        routerId,
        totalCount: codes.length,
        via: 'lan',
        awaitingLanPush: true,
      });
    }

    const [vouchers, updatedBatch] = await Promise.all([
      this.prisma.voucher.findMany({
        where: { batchId: batch.id },
        select: VOUCHER_PUBLIC,
        orderBy: { createdAt: 'asc' },
      }),
      this.prisma.voucherBatch.findUnique({
        where: { id: batch.id },
        select: { status: true, generated: true },
      }),
    ]);
    const publicVouchers = vouchers.map(toPublicVoucher);
    return {
      batchId: batch.id,
      batchSeq: batch.seq,
      batchStatus: updatedBatch?.status ?? VoucherBatchStatus.GENERATING,
      pushedByServer: Boolean(peer),
      pushedCount: updatedBatch?.generated ?? 0,
      totalCount: codes.length,
      push: peer ? undefined : push,
      // Push serveur : seuls les vouchers confirmés RouterOS sont distribuables (les autres
      // restent en base pour diagnostic). Chemin LAN : le mobile a besoin de TOUS les codes
      // pour les pousser lui-même puis confirmer (confirmPush => mikrotikId).
      vouchers: peer ? publicVouchers.filter((v) => v.provisioned) : publicVouchers,
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
    const batch = await this.prisma.voucherBatch.findFirst({
      where: { id: dto.batchId, routerId },
      select: { quantity: true },
    });
    const complete = !batch || dto.items.length >= batch.quantity;
    if (complete) {
      await this.completeBatch(dto.batchId, dto.items.length);
    } else {
      await this.prisma.voucherBatch.update({
        where: { id: dto.batchId },
        data: {
          status: VoucherBatchStatus.PARTIAL_SUCCESS,
          generated: dto.items.length,
          completedAt: new Date(),
        },
      });
    }
    const meta = {
      routerId,
      confirmed: dto.items.length,
      totalCount: batch?.quantity ?? dto.items.length,
      via: 'lan',
    };
    if (complete) await this.eventLog.success(AuditAction.UPDATE, 'VoucherBatch', dto.batchId, meta);
    else await this.eventLog.partialSuccess(AuditAction.UPDATE, 'VoucherBatch', dto.batchId, meta);
    return { confirmed: dto.items.length };
  }

  /** LOCAL path: the client could not push (all or part) over the LAN. */
  async reportPushFailure(routerId: string, dto: ReportPushFailureDto) {
    const batch = await this.prisma.voucherBatch.findFirst({
      where: { id: dto.batchId, routerId },
      select: { id: true, quantity: true },
    });
    if (!batch) {
      throw new BusinessException(HttpStatus.NOT_FOUND, ErrorCode.BATCH_NOT_FOUND, 'Lot introuvable.');
    }
    const pushed = dto.pushedCount ?? 0;
    const meta = {
      routerId,
      pushedCount: pushed,
      totalCount: batch.quantity,
      errorCode: dto.errorCode ?? ErrorCode.VOUCHER_PUSH_FAILED,
      error: dto.reason.slice(0, 300),
      via: 'lan',
    };
    if (pushed > 0) {
      await this.prisma.voucherBatch.update({
        where: { id: batch.id },
        data: { status: VoucherBatchStatus.PARTIAL_SUCCESS, generated: pushed, completedAt: new Date() },
      });
      await this.eventLog.partialSuccess(AuditAction.UPDATE, 'VoucherBatch', batch.id, meta);
    } else {
      await this.prisma.voucherBatch.update({
        where: { id: batch.id },
        data: { status: VoucherBatchStatus.FAILED },
      });
      await this.eventLog.emit({
        action: AuditAction.UPDATE,
        entityType: 'VoucherBatch',
        entityId: batch.id,
        outcome: EventOutcome.FAILED,
        metadata: meta,
      });
    }
    return { recorded: true };
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

  /**
   * Par défaut, seuls les vouchers provisionnés sont retournés : un ancien client ne
   * reçoit jamais un ticket non enregistré sur le routeur comme s'il était prêt.
   * `includeUnprovisioned` (nouveau mobile / audit) les ajoute avec `provisioned: false`.
   */
  async list(
    routerId?: string,
    status?: VoucherStatus,
    batchId?: string,
    includeUnprovisioned = false,
  ) {
    const rows = await this.prisma.voucher.findMany({
      where: {
        ...(routerId ? { routerId } : {}),
        ...(status ? { status } : {}),
        ...(batchId ? { batchId } : {}),
        ...(includeUnprovisioned ? {} : PROVISIONED_WHERE),
      },
      select: VOUCHER_PUBLIC,
      orderBy: { createdAt: 'desc' },
      take: 500,
    });
    return rows.map(toPublicVoucher);
  }

  // Point lookup for the counter-side "vérifier un ticket" flow — must not
  // depend on the `list()` `take: 500` cap, or old (but still valid) tickets
  // get falsely reported as unknown/fake.
  async lookupByCode(routerId: string, code: string) {
    const voucher = await this.prisma.voucher.findFirst({
      where: { routerId, code: { equals: code, mode: 'insensitive' } },
      select: {
        ...VOUCHER_PUBLIC,
        plan: {
          select: { id: true, name: true, priceXof: true, durationMinutes: true },
        },
      },
    });
    if (!voucher) {
      throw new BusinessException(HttpStatus.NOT_FOUND, ErrorCode.VOUCHER_NOT_FOUND, 'Ce code n\'a pas été émis pour ce routeur.');
    }
    return toPublicVoucher(voucher);
  }

  async verifyVoucherForOperator(dto: VerifyVoucherDto) {
    const where: Prisma.VoucherWhereInput = {
      code: { equals: dto.ticket, mode: 'insensitive' },
      ...(dto.routerId ? { routerId: dto.routerId } : {}),
    };

    const ctx = getTenantContext();
    if (ctx?.tenantId) {
      where.router = { tenantId: ctx.tenantId };
    }

    const voucher = await this.prisma.voucher.findFirst({
      where,
      select: {
        ...VOUCHER_PUBLIC,
        plan: {
          select: { id: true, name: true, priceXof: true, durationMinutes: true },
        },
        router: { select: { id: true, identity: true, alias: true } },
        session: {
          select: {
            status: true,
            startedAt: true,
            lastSeenAt: true,
            terminatedAt: true,
            bytesIn: true,
            bytesOut: true,
            macAddress: true,
            ipAddress: true,
          },
        },
      },
    });

    if (!voucher) {
      throw new BusinessException(HttpStatus.NOT_FOUND, ErrorCode.VOUCHER_NOT_FOUND, 'Code inconnu ou non attribué à ce routeur.');
    }

    const provisioned = isProvisioned(voucher);
    const canLogin =
      provisioned &&
      (voucher.status === VoucherStatus.GENERATED ||
        voucher.status === VoucherStatus.ACTIVE);

    const session = voucher.session
      ? {
          status: voucher.session.status,
          startedAt: voucher.session.startedAt.toISOString(),
          lastSeenAt: voucher.session.lastSeenAt?.toISOString() ?? null,
          terminatedAt: voucher.session.terminatedAt?.toISOString() ?? null,
          bytesIn: voucher.session.bytesIn.toString(),
          bytesOut: voucher.session.bytesOut.toString(),
          macAddress: voucher.session.macAddress,
          ipAddress: voucher.session.ipAddress,
        }
      : null;

    return {
      source: 'SAAS' as const,
      code: voucher.code,
      status: voucher.status,
      canLogin,
      provisioned,
      state: ticketState({ status: voucher.status, provisioned, session: voucher.session }),
      planName: voucher.plan.name,
      durationMinutes: voucher.plan.durationMinutes,
      priceXof: voucher.plan.priceXof,
      routerName: voucher.router?.alias ?? voucher.router?.identity ?? null,
      routerId: voucher.router?.id ?? null,
      createdAt: voucher.createdAt.toISOString(),
      usedAt: voucher.usedAt?.toISOString() ?? null,
      expiresAt: voucher.expiresAt?.toISOString() ?? null,
      session,
      message: !provisioned
        ? 'Ce ticket n\'a pas encore été enregistré sur le routeur.'
        : canLogin
          ? 'Ticket valide — connexion autorisée.'
          : `Ticket ${voucher.status.toLowerCase()} — connexion refusée.`,
    };
  }

  async listBatches(routerId?: string) {
    const batches = await this.prisma.voucherBatch.findMany({
      where: routerId ? { routerId } : {},
      select: {
        id: true,
        seq: true,
        planId: true,
        routerId: true,
        quantity: true,
        generated: true,
        status: true,
        createdAt: true,
        completedAt: true,
        plan: { select: { name: true, priceXof: true } },
      },
      orderBy: { createdAt: 'desc' },
      take: 200,
    });
    if (!batches.length) return [];
    // Nombres réels (pas `generated`, simple compteur de workflow) : tickets en base et
    // tickets confirmés côté RouterOS.
    const batchIds = batches.map((b) => b.id);
    const [all, ready] = await Promise.all([
      this.prisma.voucher.groupBy({
        by: ['batchId'],
        where: { batchId: { in: batchIds } },
        _count: { _all: true },
      }),
      this.prisma.voucher.groupBy({
        by: ['batchId'],
        where: { batchId: { in: batchIds }, ...PROVISIONED_WHERE },
        _count: { _all: true },
      }),
    ]);
    const countOf = (rows: { batchId: string | null; _count: { _all: number } }[]) =>
      new Map(rows.map((r) => [r.batchId, r._count._all]));
    const allBy = countOf(all);
    const readyBy = countOf(ready);
    return batches.map((b) => ({
      ...b,
      voucherCount: allBy.get(b.id) ?? 0,
      provisionedCount: readyBy.get(b.id) ?? 0,
    }));
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
    if (!voucher) throw new BusinessException(HttpStatus.NOT_FOUND, ErrorCode.VOUCHER_NOT_FOUND, 'Ticket introuvable.');
    if (voucher.status === VoucherStatus.REVOKED) {
      throw new BusinessException(HttpStatus.BAD_REQUEST, ErrorCode.VOUCHER_ALREADY_REVOKED, 'Voucher déjà révoqué');
    }

    // Verrou logique atomique sur le statut : même mécanisme que la promotion
    // GENERATED→ACTIVE (sessions.service.ts). Si le client vient de se
    // connecter, ce UPDATE conditionnel ne touche aucune ligne (count 0) et
    // on refuse plutôt que de révoquer un ticket utilisé.
    const claim = await this.prisma.voucher.updateMany({
      where: { id, status: { not: VoucherStatus.ACTIVE } },
      data: { status: VoucherStatus.REVOKED, revokedAt: new Date() },
    });
    if (claim.count === 0) {
      throw new BusinessException(
        HttpStatus.CONFLICT,
        ErrorCode.VOUCHER_ACTIVE_PROTECTED,
        'Ce ticket a déjà été activé — révocation refusée (un ticket déjà utilisé ne peut plus être annulé).',
      );
    }

    // Remove from the router only over the tunnel (REMOTE). For LOCAL routers the
    // client removes it over the LAN; DB state stays authoritative regardless.
    let routerWarning: Prisma.InputJsonObject | null = null;
    if (voucher.mikrotikId && voucher.router.mode === ManagementMode.REMOTE) {
      try {
        await this.remote.run(voucher.routerId, (client) =>
          removeHotspotUser(client, voucher.mikrotikId as string),
        );
      } catch (err) {
        this.logger.warn({
          errorCode: 'VOUCHER_REVOKE_ROUTER_UNREACHABLE',
          voucherId: id,
          routerId: voucher.routerId,
          error: err instanceof Error ? err.message : String(err),
        });
        routerWarning = { ...describeFailure(err), errorCode: ErrorCode.VOUCHER_REVOKE_ROUTER_UNREACHABLE };
      }
    }

    if (routerWarning) await this.eventLog.warning(AuditAction.REVOKE, 'Voucher', id, { routerId: voucher.routerId, ...routerWarning });
    else await this.eventLog.success(AuditAction.REVOKE, 'Voucher', id, { routerId: voucher.routerId });
    return { revoked: true };
  }

  /**
   * Permanent delete — GENERATED/REVOKED uniquement. Un voucher ACTIVE n'est
   * jamais supprimé, qu'un client soit connecté ou non : son revenu est déjà
   * compté dans les rapports (voir revenue.service.ts), le supprimer
   * détruirait cet historique. Voir le verrou logique ci-dessous, identique
   * à celui de revoke().
   */
  async remove(id: string) {
    const voucher = await this.prisma.voucher.findFirst({
      where: { id },
      select: {
        id: true,
        routerId: true,
        mikrotikId: true,
        router: { select: { mode: true } },
      },
    });
    if (!voucher) throw new BusinessException(HttpStatus.NOT_FOUND, ErrorCode.VOUCHER_NOT_FOUND, 'Ticket introuvable.');

    // Le UPDATE conditionnel réclame la ligne de façon atomique avant toute
    // suppression : si le statut est passé à ACTIVE entre-temps (client qui
    // vient de se connecter), `claim.count` vaut 0 et rien n'est jamais
    // supprimé — ni la Session, ni le Voucher, ni l'utilisateur RouterOS.
    const deleted = await this.prisma.$transaction(async (tx) => {
      const claim = await tx.voucher.updateMany({
        where: { id, status: { not: VoucherStatus.ACTIVE } },
        data: { status: VoucherStatus.REVOKED, revokedAt: new Date() },
      });
      if (claim.count === 0) return false;
      await tx.session.deleteMany({ where: { voucherId: id } });
      await tx.voucher.delete({ where: { id } });
      return true;
    });
    if (!deleted) {
      throw new BusinessException(
        HttpStatus.CONFLICT,
        ErrorCode.VOUCHER_ACTIVE_PROTECTED,
        'Ce ticket a déjà été activé — suppression refusée (conservé pour l\'historique des ventes, ou en cours d\'utilisation).',
      );
    }

    let routerWarning: Prisma.InputJsonObject | null = null;
    if (voucher.mikrotikId && voucher.router.mode === ManagementMode.REMOTE) {
      try {
        await this.remote.run(voucher.routerId, (client) =>
          removeHotspotUser(client, voucher.mikrotikId as string),
        );
      } catch (err) {
        this.logger.warn({
          errorCode: 'VOUCHER_DELETE_ROUTER_UNREACHABLE',
          voucherId: id,
          routerId: voucher.routerId,
          error: err instanceof Error ? err.message : String(err),
        });
        routerWarning = { ...describeFailure(err), errorCode: ErrorCode.VOUCHER_DELETE_ROUTER_UNREACHABLE };
      }
    }
    if (routerWarning) await this.eventLog.warning(AuditAction.DELETE, 'Voucher', id, { routerId: voucher.routerId, ...routerWarning });
    else await this.eventLog.success(AuditAction.DELETE, 'Voucher', id, { routerId: voucher.routerId });
    return { deleted: true };
  }

  /**
   * Répartition par statut d'un lot, calculée avant toute suppression — sert
   * à afficher trois compteurs distincts avant que l'opérateur confirme :
   * "X seront supprimés / Y déjà vendus conservés (historique) / Z clients
   * connectés maintenant, protégés".
   */
  async previewBatchDeletion(batchId: string): Promise<BatchDeletionPreview> {
    const batch = await this.prisma.voucherBatch.findFirst({ where: { id: batchId }, select: { id: true } });
    if (!batch) throw new BusinessException(HttpStatus.NOT_FOUND, ErrorCode.BATCH_NOT_FOUND, 'Lot introuvable.');
    return this.previewDeletion({ batchId });
  }

  /** Même calcul que previewBatchDeletion(), pour tous les tickets d'un routeur. */
  async previewRouterCleanup(routerId: string): Promise<Omit<BatchDeletionPreview, 'batchId'>> {
    const { batchId: _batchId, ...rest } = await this.previewDeletion({ routerId });
    return rest;
  }

  private async previewDeletion(where: { batchId?: string; routerId?: string }): Promise<BatchDeletionPreview> {
    const grouped = await this.prisma.voucher.groupBy({
      by: ['status'],
      where,
      _count: { _all: true },
    });
    const total = grouped.reduce((sum, g) => sum + g._count._all, 0);
    const totalActive = grouped.find((g) => g.status === VoucherStatus.ACTIVE)?._count._all ?? 0;
    // Session ouverte maintenant = client connecté. Un ACTIVE sans Session
    // ouverte a déjà été utilisé (revenu déjà compté) mais n'est plus
    // connecté — deux raisons différentes de ne jamais le supprimer.
    const connectedNow = await this.prisma.voucher.count({
      where: { ...where, status: VoucherStatus.ACTIVE, session: { status: SessionStatus.ACTIVE } },
    });
    return {
      batchId: where.batchId ?? null,
      total,
      eligible: total - totalActive,
      keptForHistory: totalActive - connectedNow,
      connectedNow,
    };
  }

  /**
   * Permanent delete of a batch and every eligible voucher (+ session) it
   * contains. Les vouchers ACTIVE (déjà vendus, connectés ou non) sont
   * toujours conservés, même si `previewBatchDeletion()` les comptait comme
   * protégés il y a un instant : le verrou logique est réévalué au commit.
   */
  async removeBatch(batchId: string): Promise<BulkDeletionResult> {
    const batch = await this.prisma.voucherBatch.findFirst({
      where: { id: batchId },
      select: { id: true },
    });
    if (!batch) throw new BusinessException(HttpStatus.NOT_FOUND, ErrorCode.BATCH_NOT_FOUND, 'Lot introuvable.');

    const result = await this.removeEligible({ batchId });
    await this.eventLog[result.protectedActive > 0 || result.routerCleanupFailed > 0 ? 'partialSuccess' : 'success'](
      AuditAction.DELETE,
      'VoucherBatch',
      batchId,
      { ...result },
    );
    return result;
  }

  /** "Nettoyer les tickets" — même règle que removeBatch(), à l'échelle d'un routeur. */
  async removeAllEligible(routerId: string): Promise<BulkDeletionResult> {
    const result = await this.removeEligible({ routerId });
    await this.eventLog[result.protectedActive > 0 || result.routerCleanupFailed > 0 ? 'partialSuccess' : 'success'](
      AuditAction.DELETE,
      'Router',
      routerId,
      { ...result },
    );
    return result;
  }

  private async removeEligible(scope: { batchId?: string; routerId?: string }): Promise<BulkDeletionResult> {
    const candidates = await this.prisma.voucher.findMany({
      where: scope,
      select: {
        id: true,
        status: true,
        batchId: true,
        mikrotikId: true,
        routerId: true,
        router: { select: { mode: true } },
        session: { select: { status: true } },
      },
    });
    const analyzed = candidates.length;
    const eligibleIds = candidates
      .filter((v) => v.status !== VoucherStatus.ACTIVE)
      .map((v) => v.id);

    const deletedIds = await this.prisma.$transaction(async (tx) => {
      if (!eligibleIds.length) return [] as string[];
      // Réclame chaque ligne éligible avant de la supprimer, sous la même
      // garantie que remove()/revoke() : un voucher promu ACTIVE entre le
      // snapshot `candidates` et ce commit n'est jamais réclamé.
      await tx.voucher.updateMany({
        where: { id: { in: eligibleIds }, status: { not: VoucherStatus.ACTIVE } },
        data: { status: VoucherStatus.REVOKED, revokedAt: new Date() },
      });
      const claimed = await tx.voucher.findMany({
        where: { id: { in: eligibleIds }, status: VoucherStatus.REVOKED },
        select: { id: true },
      });
      const ids = claimed.map((v) => v.id);
      await tx.session.deleteMany({ where: { voucherId: { in: ids } } });
      await tx.voucher.deleteMany({ where: { id: { in: ids } } });

      const affectedBatchIds = [
        ...new Set(
          candidates
            .filter((v) => v.batchId && ids.includes(v.id))
            .map((v) => v.batchId as string),
        ),
      ];
      for (const bId of affectedBatchIds) {
        const remaining = await tx.voucher.count({ where: { batchId: bId } });
        if (remaining === 0) await tx.voucherBatch.delete({ where: { id: bId } });
      }
      return ids;
    });

    const deleted = new Set(deletedIds);
    let routerCleanupFailed = 0;
    for (const v of candidates) {
      if (!deleted.has(v.id)) continue;
      if (v.mikrotikId && v.router.mode === ManagementMode.REMOTE) {
        try {
          await this.remote.run(v.routerId, (client) => removeHotspotUser(client, v.mikrotikId as string));
        } catch (err) {
          routerCleanupFailed += 1;
          this.logger.warn({
            errorCode: 'VOUCHER_BULK_DELETE_ROUTER_UNREACHABLE',
            voucherId: v.id,
            routerId: v.routerId,
            error: err instanceof Error ? err.message : String(err),
          });
        }
      }
    }

    // Parmi les protégés (status ACTIVE, jamais réclamés ci-dessus) : ceux
    // avec une Session encore ouverte sont connectés maintenant, les autres
    // sont juste déjà vendus (revenu déjà compté, conservés pour l'historique).
    let connectedNow = 0;
    for (const v of candidates) {
      if (deleted.has(v.id)) continue;
      if (v.session?.status === SessionStatus.ACTIVE) connectedNow += 1;
    }
    const protectedActive = analyzed - deleted.size;

    return {
      analyzed,
      deleted: deleted.size,
      protectedActive,
      connectedNow,
      keptForHistory: protectedActive - connectedNow,
      routerCleanupFailed,
    };
  }

  private async uniqueCodes(
    quantity: number,
    opts: CodeFormatOptions,
  ): Promise<string[]> {
    const set = new Set<string>();
    while (set.size < quantity) set.add(this.genCode(opts));
    let codes = [...set];

    const existing = await this.prisma.voucher.findMany({
      where: { code: { in: codes } },
      select: { code: true },
    });
    if (existing.length) {
      const taken = new Set(existing.map((v) => v.code));
      codes = codes.filter((c) => !taken.has(c));
      while (codes.length < quantity) {
        const c = this.genCode(opts);
        if (!taken.has(c) && !codes.includes(c)) codes.push(c);
      }
    }
    return codes;
  }

  private genCode(opts: CodeFormatOptions): string {
    const alphabet = opts.codeFormat === 'NUMERIC' ? NUMERIC : ALPHANUMERIC;
    const length = opts.codeLength || 8;
    const b = randomBytes(length);
    let s = '';
    for (let i = 0; i < length; i += 1) s += alphabet[b[i] % alphabet.length];
    return (opts.codePrefix || '') + s;
  }
}
