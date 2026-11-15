import { Injectable, Logger } from '@nestjs/common';
import { AuditAction, EventOutcome } from '@prisma/client';
import { createHash } from 'node:crypto';
import { PrismaService } from '../../prisma/prisma.service';

/**
 * Événements du cycle de vie des sessions. Aucun jeton, e-mail, IP ni identifiant brut utilisateur/tenant :
 * seulement des références pseudonymisées (SHA-256 tronqué), l'identifiant de famille (UUID aléatoire),
 * une cause et des durées.
 */
export const AUTH_EVENTS = [
  'REFRESH_SUCCESS',
  'REFRESH_ROTATED',
  'REFRESH_REUSE_DETECTED',
  'REFRESH_FAMILY_REVOKED',
  'REFRESH_EXPIRED',
  'REFRESH_INVALID',
  'LOGOUT_USER',
  'LOGOUT_ALL_SESSIONS',
  'PASSWORD_CHANGED',
  'DEVICE_REVOKED',
] as const;
export type AuthEventName = (typeof AUTH_EVENTS)[number];

/** Événements rares et critiques, conservés dans le journal d'audit (les autres : logs + compteurs mémoire). */
const PERSISTED: ReadonlySet<AuthEventName> = new Set<AuthEventName>([
  'REFRESH_REUSE_DETECTED',
  'REFRESH_FAMILY_REVOKED',
  'REFRESH_EXPIRED',
  'LOGOUT_ALL_SESSIONS',
  'PASSWORD_CHANGED',
  'DEVICE_REVOKED',
]);
const WARNING: ReadonlySet<AuthEventName> = new Set<AuthEventName>([
  'REFRESH_REUSE_DETECTED',
  'REFRESH_FAMILY_REVOKED',
  'REFRESH_EXPIRED',
]);

export interface AuthEventContext {
  userId?: string | null;
  tenantId?: string | null;
  /** Famille de jetons de rafraîchissement = une « session » côté serveur. */
  familyId?: string | null;
  cause: string;
  extra?: Record<string, number | string | boolean>;
}

const DAY_MS = 24 * 3_600_000;
const MAX_STAMPS = 50_000;

export function authRef(value: string): string {
  return createHash('sha256').update(value).digest('hex').slice(0, 16);
}

export interface AuthSessionMetrics {
  windowHours: 24;
  /** Compteurs mémoire : repartent de zéro à chaque redémarrage du service (`counterSince`). */
  counterSince: string;
  refreshSuccess24h: number;
  refreshRotated24h: number;
  refreshInvalid24h: number;
  logoutUser24h: number;
  /** Compteurs persistants (journal d'audit). */
  refreshReuseDetected24h: number;
  refreshFamilyRevoked24h: number;
  refreshExpired24h: number;
  logoutAllSessions24h: number;
  credentialsChanged24h: number;
  deviceRevoked24h: number;
}

@Injectable()
export class AuthEventsService {
  private readonly logger = new Logger('AuthEvents');
  private readonly stamps = new Map<AuthEventName, number[]>();
  private readonly startedAt = new Date();

  constructor(private readonly prisma: PrismaService) {}

  /** Jamais de throw : l'observabilité ne doit pas casser l'authentification. */
  record(event: AuthEventName, ctx: AuthEventContext, now: Date = new Date()): void {
    try {
      this.bump(event, now.getTime());
      const payload = {
        event,
        cause: ctx.cause,
        userRef: ctx.userId ? authRef(ctx.userId) : undefined,
        tenantRef: ctx.tenantId ? authRef(ctx.tenantId) : undefined,
        familyId: ctx.familyId ?? undefined,
        ...ctx.extra,
        at: now.toISOString(),
      };
      const line = JSON.stringify(payload);
      if (WARNING.has(event)) this.logger.warn(line);
      else this.logger.log(line);
      if (PERSISTED.has(event) && ctx.tenantId) {
        void this.persist(event, ctx, payload).catch((e: unknown) =>
          this.safeWarn(`audit auth non écrit (${event}): ${e instanceof Error ? e.message : String(e)}`),
        );
      }
    } catch (e) {
      this.safeWarn(`événement auth ignoré (${event}): ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  /** L'observabilité ne doit jamais casser l'authentification, même si le logger est en panne. */
  private safeWarn(message: string): void {
    try {
      this.logger.warn(message);
    } catch {
      // volontairement ignoré
    }
  }

  async metrics(now: Date = new Date()): Promise<AuthSessionMetrics> {
    const since = new Date(now.getTime() - DAY_MS);
    const persisted = async (event: AuthEventName): Promise<number> =>
      this.prisma.auditLog.count({
        where: { entityType: 'AuthSession', createdAt: { gte: since }, metadata: { path: ['event'], equals: event } },
      });
    const [reuse, revoked, expired, logoutAll, pwd, device] = await Promise.all([
      persisted('REFRESH_REUSE_DETECTED'),
      persisted('REFRESH_FAMILY_REVOKED'),
      persisted('REFRESH_EXPIRED'),
      persisted('LOGOUT_ALL_SESSIONS'),
      persisted('PASSWORD_CHANGED'),
      persisted('DEVICE_REVOKED'),
    ]);
    return {
      windowHours: 24,
      counterSince: this.startedAt.toISOString(),
      refreshSuccess24h: this.count('REFRESH_SUCCESS', now.getTime()),
      refreshRotated24h: this.count('REFRESH_ROTATED', now.getTime()),
      refreshInvalid24h: this.count('REFRESH_INVALID', now.getTime()),
      logoutUser24h: this.count('LOGOUT_USER', now.getTime()),
      refreshReuseDetected24h: reuse,
      refreshFamilyRevoked24h: revoked,
      refreshExpired24h: expired,
      logoutAllSessions24h: logoutAll,
      credentialsChanged24h: pwd,
      deviceRevoked24h: device,
    };
  }

  private async persist(event: AuthEventName, ctx: AuthEventContext, payload: Record<string, unknown>): Promise<void> {
    await this.prisma.auditLog.create({
      data: {
        tenantId: ctx.tenantId as string,
        userId: ctx.userId ?? null,
        action: event === 'PASSWORD_CHANGED' ? AuditAction.UPDATE : AuditAction.REVOKE,
        entityType: 'AuthSession',
        entityId: ctx.familyId ?? null,
        metadata: payload as object,
        outcome: WARNING.has(event) ? EventOutcome.WARNING : EventOutcome.SUCCESS,
      },
    });
  }

  private bump(event: AuthEventName, nowMs: number): void {
    const list = this.stamps.get(event) ?? [];
    list.push(nowMs);
    const cutoff = nowMs - DAY_MS;
    while (list.length > 0 && (list[0] as number) < cutoff) list.shift();
    if (list.length > MAX_STAMPS) list.splice(0, list.length - MAX_STAMPS);
    this.stamps.set(event, list);
  }

  private count(event: AuthEventName, nowMs: number): number {
    const cutoff = nowMs - DAY_MS;
    return (this.stamps.get(event) ?? []).filter((t) => t >= cutoff).length;
  }
}
