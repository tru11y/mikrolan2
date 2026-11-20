import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  AuditAction,
  RouterLinkAuthMode,
  SessionStatus,
  UserRole,
  VoucherStatus,
} from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { EventsService } from '../events/events.service';
import { NotificationsService } from '../notifications/notifications.service';
import { EventLogService } from '../events/event-log.service';
import { setTenantContext, tenantStore } from '../../common/context/tenant-context';
import { computeExpiresAt, isProvisioned } from '../vouchers/voucher.service';
import { firstSightActivation } from '../sessions/first-sight';
import { ErrorCode } from '../../common/error-codes';
import { RadiusCoaService } from './radius-coa.service';
import { assembleOctets, isNasLevelStatus, mikrotikRateLimit } from './radius.util';
import type {
  AccountingDto,
  AuthorizeDto,
  AuthorizeResponse,
} from './dto/radius.schemas';

interface ResolvedNas {
  routerId: string;
  tenantId: string;
}

/** Voucher chargé pour authorize/accounting (isolation + quota + revenu). */
type LoadedVoucher = {
  id: string;
  code: string;
  tenantId: string;
  routerId: string;
  linkId: string | null;
  status: VoucherStatus;
  mikrotikId: string | null;
  radiusDistributable: boolean;
  usedAt: Date | null;
  plan: {
    priceXof: number;
    durationMinutes: number;
    dataLimitMb: number | null;
    uploadKbps: number | null;
    downloadKbps: number | null;
  };
  link: {
    authMode: RouterLinkAuthMode;
    routers: { routerId: string }[];
  } | null;
};

@Injectable()
export class RadiusService {
  private readonly logger = new Logger(RadiusService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly events: EventsService,
    private readonly notifications: NotificationsService,
    private readonly config: ConfigService,
    private readonly coa: RadiusCoaService,
    private readonly eventLog: EventLogService,
  ) {}

  // ─── Résolution NAS (AVANT tout contexte tenant) ────────────────────────
  /**
   * Le tenant n'est pas encore connu : cette requête tourne HORS filtre tenant
   * (aucun contexte ouvert → le middleware Prisma ne scope pas).
   *
   * SÉCURITÉ : `NAS-IP-Address` ici n'est PAS l'attribut RADIUS fourni par le
   * NAS (falsifiable) mais l'IP SOURCE du paquet UDP (`%{Packet-Src-IP-Address}`,
   * cf. deploy/radius/.../mods-available/rest), authentifiée par FreeRADIUS
   * contre le secret par-client. C'est la seule entrée de confiance pour choisir
   * le tenant. On ne sélectionne JAMAIS le tenant via un attribut client
   * (NAS-Identifier) : il permettrait un bypass d'isolation cross-tenant.
   */
  async resolveNas(dto: AuthorizeDto | AccountingDto): Promise<ResolvedNas | null> {
    const nasIp = dto['NAS-IP-Address'];
    if (!nasIp) return null; // source inconnue → fail-closed

    const peer = await this.prisma.remotePeer.findFirst({
      where: { wgIp: nasIp },
      select: { routerId: true, tenantId: true },
    });
    if (peer) return { routerId: peer.routerId, tenantId: peer.tenantId };

    const byLocal = await this.prisma.router.findMany({
      where: { deletedAt: null, localAddress: { startsWith: nasIp } },
      select: { id: true, tenantId: true, localAddress: true },
    });
    const exact = byLocal.filter((r) => (r.localAddress ?? '').split(':')[0] === nasIp);
    if (exact.length === 1) return { routerId: exact[0].id, tenantId: exact[0].tenantId };

    return null; // aucun match (ou ambigu) → fail-closed
  }

  /** Ouvre un contexte tenant système (OWNER) autour d'un traitement scopé. */
  private runInTenant<T>(nas: ResolvedNas, fn: () => Promise<T>): Promise<T> {
    return tenantStore.run({}, () => {
      setTenantContext({ tenantId: nas.tenantId, userId: 'system-radius', role: UserRole.OWNER });
      return fn();
    });
  }

  private async loadVoucher(code: string): Promise<LoadedVoucher | null> {
    return this.prisma.voucher.findFirst({
      where: { code: { equals: code, mode: 'insensitive' } },
      select: {
        id: true,
        code: true,
        tenantId: true,
        routerId: true,
        linkId: true,
        status: true,
        mikrotikId: true,
        radiusDistributable: true,
        usedAt: true,
        plan: {
          select: {
            priceXof: true,
            durationMinutes: true,
            dataLimitMb: true,
            uploadKbps: true,
            downloadKbps: true,
          },
        },
        link: {
          select: {
            authMode: true,
            routers: { select: { routerId: true } },
          },
        },
      },
    });
  }

  /**
   * Cœur de l'isolation (fail-closed) : le voucher appartient-il bien à ce
   * tenant ET le NAS fait-il partie des routeurs autorisés ? En mode RADIUS le
   * NAS doit être membre du lien ; sinon (DIRECT / linkId null) le voucher doit
   * être rattaché à ce routeur précis.
   */
  private isIsolationOk(voucher: LoadedVoucher, nas: ResolvedNas): boolean {
    if (voucher.tenantId !== nas.tenantId) return false;
    const useLink =
      voucher.linkId !== null &&
      voucher.link !== null &&
      voucher.link.authMode === RouterLinkAuthMode.RADIUS;
    return useLink
      ? voucher.link!.routers.some((m) => m.routerId === nas.routerId)
      : voucher.routerId === nas.routerId;
  }

  /** Somme bytesIn+bytesOut de TOUTES les sessions du voucher (quota partagé). */
  private async usedBytes(voucherId: string): Promise<bigint> {
    const agg = await this.prisma.session.aggregate({
      where: { voucherId },
      _sum: { bytesIn: true, bytesOut: true },
    });
    return (agg._sum.bytesIn ?? 0n) + (agg._sum.bytesOut ?? 0n);
  }

  /**
   * Quota en octets. NOTE (écart spec) : `RouterLink.linkQuotaBytes` n'existe pas
   * dans le schéma PR1 — le quota provient donc de `Plan.dataLimitMb`. Null =
   * illimité. L'ajout d'un quota au niveau lien reste un changement d'une ligne ici.
   */
  private quotaBytes(voucher: LoadedVoucher): bigint | null {
    return voucher.plan.dataLimitMb !== null
      ? BigInt(voucher.plan.dataLimitMb) * 1024n * 1024n
      : null;
  }

  // ─── authorize ──────────────────────────────────────────────────────────
  async authorize(dto: AuthorizeDto): Promise<AuthorizeResponse> {
    const nas = await this.resolveNas(dto);
    if (!nas) {
      this.logger.warn(`authorize NAS inconnu user=${dto['User-Name']}`);
      return reject('NAS inconnu');
    }
    return this.runInTenant(nas, () => this.authorizeInTenant(dto, nas));
  }

  private async authorizeInTenant(
    dto: AuthorizeDto,
    nas: ResolvedNas,
  ): Promise<AuthorizeResponse> {
    const voucher = await this.loadVoucher(dto['User-Name']);
    if (!voucher) {
      await this.auditReject(nas, dto['User-Name'], ErrorCode.RADIUS_VOUCHER_REJECTED, 'UNKNOWN');
      return reject('Code inconnu');
    }
    if (!this.isIsolationOk(voucher, nas)) {
      await this.auditReject(nas, voucher.code, ErrorCode.RADIUS_CROSS_TENANT, 'CROSS_TENANT');
      return reject('Code refusé');
    }
    if (
      !isProvisioned({
        mikrotikId: voucher.mikrotikId,
        radiusDistributable: voucher.radiusDistributable,
        authMode: voucher.link?.authMode ?? null,
      })
    ) {
      await this.auditReject(nas, voucher.code, ErrorCode.RADIUS_VOUCHER_REJECTED, 'NOT_PROVISIONED');
      return reject('Code non provisionné');
    }
    if (
      voucher.status === VoucherStatus.REVOKED ||
      voucher.status === VoucherStatus.EXPIRED ||
      voucher.status === VoucherStatus.USED
    ) {
      await this.auditReject(nas, voucher.code, ErrorCode.RADIUS_VOUCHER_REJECTED, voucher.status);
      return reject('Code non valide');
    }

    const now = new Date();
    const expiresAt = computeExpiresAt(voucher.usedAt, voucher.plan.durationMinutes);
    if (expiresAt && expiresAt.getTime() <= now.getTime()) {
      await this.auditReject(nas, voucher.code, ErrorCode.RADIUS_VOUCHER_REJECTED, 'EXPIRED');
      return reject('Code expiré');
    }

    const quota = this.quotaBytes(voucher);
    const used = await this.usedBytes(voucher.id);
    const remainingBytes = quota !== null ? quota - used : null;
    if (remainingBytes !== null && remainingBytes <= 0n) {
      await this.auditReject(nas, voucher.code, ErrorCode.RADIUS_QUOTA_EXHAUSTED, 'QUOTA');
      return reject('Quota épuisé');
    }

    const remainingSeconds = expiresAt
      ? Math.max(0, Math.floor((expiresAt.getTime() - now.getTime()) / 1000))
      : voucher.plan.durationMinutes * 60;

    const rateLimit = mikrotikRateLimit(voucher.plan.uploadKbps, voucher.plan.downloadKbps);
    return {
      'control:Auth-Type': 'Accept',
      'reply:Session-Timeout': remainingSeconds,
      ...(remainingBytes !== null ? { 'reply:Mikrotik-Total-Limit': remainingBytes.toString() } : {}),
      ...(rateLimit ? { 'reply:Mikrotik-Rate-Limit': rateLimit } : {}),
      'reply:Acct-Interim-Interval': this.interimInterval(),
    };
  }

  // ─── accounting ─────────────────────────────────────────────────────────
  /** Ne lève jamais : le contrôleur répond toujours 200 (sinon le NAS retente). */
  async accounting(dto: AccountingDto): Promise<void> {
    const nas = await this.resolveNas(dto);
    if (!nas) {
      this.logger.warn(`accounting NAS inconnu status=${dto['Acct-Status-Type']}`);
      return;
    }
    await this.runInTenant(nas, () => this.accountingInTenant(dto, nas));
  }

  private async accountingInTenant(dto: AccountingDto, nas: ResolvedNas): Promise<void> {
    const status = dto['Acct-Status-Type'];

    if (isNasLevelStatus(status)) {
      // Redémarrage/arrêt du NAS : toutes ses sessions ACTIVE sont caduques.
      await this.prisma.session.updateMany({
        where: { routerId: nas.routerId, status: SessionStatus.ACTIVE },
        data: { status: SessionStatus.TERMINATED, terminatedAt: new Date() },
      });
      return;
    }

    const code = dto['User-Name'];
    if (!code || !dto['Acct-Unique-Session-Id']) {
      this.logger.warn(`accounting ${status} sans User-Name/Acct-Unique-Session-Id — ignoré`);
      return;
    }

    const voucher = await this.loadVoucher(code);
    if (!voucher || !this.isIsolationOk(voucher, nas)) {
      this.logger.warn(`accounting ${status} voucher introuvable/isolation refusée code=${code}`);
      return;
    }

    const now = new Date();
    const inBytes = assembleOctets(dto['Acct-Input-Octets'], dto['Acct-Input-Gigawords']);
    const outBytes = assembleOctets(dto['Acct-Output-Octets'], dto['Acct-Output-Gigawords']);

    if (status === 'Start') {
      // Snapshot de revenu (idempotent, partagé avec reconcileActive).
      if (voucher.status === VoucherStatus.GENERATED) {
        await firstSightActivation(
          { prisma: this.prisma, events: this.events, notifications: this.notifications },
          {
            voucherId: voucher.id,
            code: voucher.code,
            planPriceXof: voucher.plan.priceXof,
            routerId: nas.routerId,
            tenantId: nas.tenantId,
            now,
            logger: this.logger,
          },
        );
      }
      await this.upsertSession(dto, nas, voucher.id, inBytes, outBytes, SessionStatus.ACTIVE, now);
      return;
    }

    if (status === 'Interim-Update') {
      await this.upsertSession(dto, nas, voucher.id, inBytes, outBytes, SessionStatus.ACTIVE, now);
      await this.enforceQuota(voucher);
      return;
    }

    // Stop : compteurs finaux, session terminée, pas de recalcul de revenu.
    await this.upsertSession(
      dto,
      nas,
      voucher.id,
      inBytes,
      outBytes,
      SessionStatus.TERMINATED,
      now,
      now,
    );
    await this.enforceQuota(voucher);
  }

  /**
   * Upsert idempotent par (voucherId, routerId). Compteurs ABSOLUS : on garde
   * `max(reçu, stocké)` pour ne jamais reculer (réordonnancement, rejeu du même
   * Acct-Unique-Session-Id).
   */
  private async upsertSession(
    dto: AccountingDto,
    nas: ResolvedNas,
    voucherId: string,
    inBytes: bigint,
    outBytes: bigint,
    status: SessionStatus,
    now: Date,
    terminatedAt?: Date,
  ): Promise<void> {
    const existing = await this.prisma.session.findUnique({
      where: { voucherId_routerId: { voucherId, routerId: nas.routerId } },
      select: { bytesIn: true, bytesOut: true },
    });
    const bytesIn = existing && existing.bytesIn > inBytes ? existing.bytesIn : inBytes;
    const bytesOut = existing && existing.bytesOut > outBytes ? existing.bytesOut : outBytes;

    const common = {
      nasIdentifier: dto['NAS-Identifier'] ?? null,
      acctSessionId: dto['Acct-Session-Id'] ?? null,
      ipAddress: dto['Framed-IP-Address'] ?? null,
      macAddress: dto['Calling-Station-Id'] ?? null,
      bytesIn,
      bytesOut,
      status,
      lastSeenAt: now,
      terminatedAt: terminatedAt ?? null,
    };
    await this.prisma.session.upsert({
      where: { voucherId_routerId: { voucherId, routerId: nas.routerId } },
      create: { tenantId: nas.tenantId, voucherId, routerId: nas.routerId, ...common },
      update: common,
    });
  }

  /** Quota partagé dépassé → CoA (déconnexion sur tous les NAS du voucher). */
  private async enforceQuota(voucher: LoadedVoucher): Promise<void> {
    const quota = this.quotaBytes(voucher);
    if (quota === null) return;
    const used = await this.usedBytes(voucher.id);
    if (used >= quota) {
      await this.coa.disconnectVoucherEverywhere(voucher.id);
    }
  }

  private interimInterval(): number {
    return this.config.get<number>('RADIUS_INTERIM_INTERVAL') ?? 30;
  }

  private async auditReject(
    nas: ResolvedNas,
    code: string,
    errorCode: string,
    reason: string,
  ): Promise<void> {
    await this.eventLog.warning(
      AuditAction.REJECT,
      'Voucher',
      undefined,
      { reason, errorCode, code, routerId: nas.routerId },
      { tenantId: nas.tenantId, userId: 'system-radius' },
    );
  }
}

function reject(message: string): AuthorizeResponse {
  return { 'control:Auth-Type': 'Reject', 'reply:Reply-Message': message };
}
