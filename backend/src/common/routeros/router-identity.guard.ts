import { HttpStatus, Logger } from '@nestjs/common';
import { BusinessException } from '../exceptions/business.exception';
import { ErrorCode } from '../error-codes';

/**
 * Garde d'identité pour les opérations « LAN » rapportées par le mobile (sessions, confirmation de
 * vouchers) : le client n'est pas une source d'autorité, il envoie l'identité RouterOS qu'il a
 * réellement lue (`/system/identity`) sur le MikroTik joint, et le serveur la compare à celle du
 * routeur demandé AVANT toute mutation. Deux MikroTik peuvent partager la même adresse LAN
 * (10.10.10.1, 192.168.88.1) : l'adresse ne prouve rien.
 *
 * Politique pour les anciens APK (aucune identité envoyée) — `LAN_IDENTITY_POLICY` :
 *  - `warn` (défaut, étape 1) : comportement historique conservé, trace d'avertissement ;
 *  - `enforce` (étape 2, une fois les APK mis à jour) : refus 409 `ROUTER_IDENTITY_REQUIRED`.
 */
export type LanIdentityPolicy = 'warn' | 'enforce';

const logger = new Logger('LanIdentityGuard');
const GENERIC_IDENTITIES = /^(mikrotik|routeros|router|default|admin)([-_ ]?\d+)?$/i;
const lastLegacyWarn = new Map<string, number>();
const LEGACY_WARN_EVERY_MS = 10 * 60_000;

export function lanIdentityPolicy(): LanIdentityPolicy {
  return process.env['LAN_IDENTITY_POLICY'] === 'enforce' ? 'enforce' : 'warn';
}

/** Identité par défaut/générique : ne constitue pas une preuve forte (peut exister sur un autre MikroTik). */
export function isGenericIdentity(identity: string): boolean {
  const v = identity.trim();
  return v === '' || GENERIC_IDENTITIES.test(v);
}

export type AuditFn = (reason: string, meta: Record<string, string>) => Promise<void> | void;

export async function assertObservedRouterIdentity(input: {
  routerId: string;
  expectedIdentity: string;
  observedRouterIdentity: string | undefined;
  operation: 'LAN_SESSION_SYNC' | 'LAN_VOUCHER_CONFIRM';
  audit?: AuditFn;
}): Promise<void> {
  const { routerId, expectedIdentity, observedRouterIdentity, operation, audit } = input;

  if (observedRouterIdentity === undefined) {
    if (lanIdentityPolicy() === 'enforce') {
      await safeAudit(audit, 'IDENTITY_REQUIRED', { operation });
      throw new BusinessException(
        HttpStatus.CONFLICT,
        ErrorCode.ROUTER_IDENTITY_REQUIRED,
        "Mettez l'application à jour : l'identité du routeur doit être vérifiée avant ce rapport.",
      );
    }
    const now = Date.now();
    if (now - (lastLegacyWarn.get(routerId) ?? 0) > LEGACY_WARN_EVERY_MS) {
      lastLegacyWarn.set(routerId, now);
      logger.warn(`legacy client without observedRouterIdentity routerId=${routerId} op=${operation}`);
    }
    return;
  }

  if (observedRouterIdentity.trim() !== expectedIdentity.trim()) {
    await safeAudit(audit, 'IDENTITY_MISMATCH', { operation });
    throw new BusinessException(
      HttpStatus.CONFLICT,
      ErrorCode.ROUTER_IDENTITY_MISMATCH,
      "Le routeur joint sur le réseau n'est pas celui sélectionné : rapport refusé.",
    );
  }
}

async function safeAudit(audit: AuditFn | undefined, reason: string, meta: Record<string, string>): Promise<void> {
  try {
    await audit?.(reason, meta);
  } catch {
    // La trace ne doit jamais masquer le refus.
  }
}
