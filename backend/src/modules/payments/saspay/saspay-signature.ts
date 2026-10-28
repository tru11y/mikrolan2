import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * Vérification HMAC d'un webhook SasPay.
 *
 * Protocole SasPay (docs.saspay.me/api-reference/webhooks) :
 *   signed    = `${timestamp}.${rawBody}`
 *   signature = hex(HMAC_SHA256(signing_secret, signed))
 *
 * Deux contrôles obligatoires :
 *   1. L'horodatage doit être proche de maintenant (anti-replay).
 *   2. La signature doit correspondre, comparée en temps constant.
 *
 * Fonction pure (aucun I/O, aucune dépendance Nest) — testable à l'unité
 * directement sur des vecteurs connus.
 */

export const SASPAY_SIGNATURE_HEADER = 'x-webhook-signature';
export const SASPAY_TIMESTAMP_HEADER = 'x-webhook-timestamp';
export const SASPAY_EVENT_HEADER = 'x-webhook-event';

export const SASPAY_TIMESTAMP_TOLERANCE_SECONDS = 300;

export interface VerifyWebhookInput {
  rawBody: Buffer | string;
  signatureHeader: string | undefined;
  timestampHeader: string | undefined;
  secret: string;
  /** Secondes Unix, injecté en test. Par défaut `Date.now()`. */
  nowSeconds?: number;
  /** Tolérance en secondes, 300 par défaut (recommandation SasPay). */
  toleranceSeconds?: number;
}

export type VerifyWebhookResult =
  | { ok: true }
  | {
      ok: false;
      reason:
        | 'missing_signature'
        | 'missing_timestamp'
        | 'invalid_timestamp'
        | 'expired_timestamp'
        | 'signature_mismatch'
        | 'missing_secret';
    };

/**
 * Vérifie un webhook SasPay.
 *
 * - `rawBody` : le corps HTTP exact tel que reçu (jamais re-sérialisé).
 *   L'ordre des clés et le formatage des nombres peuvent différer d'une
 *   re-sérialisation JSON, ce qui casse la comparaison HMAC bit à bit.
 * - La comparaison des signatures utilise `timingSafeEqual` pour éviter
 *   la fuite de la signature attendue par mesure du temps de réponse.
 */
export function verifySaspayWebhook(input: VerifyWebhookInput): VerifyWebhookResult {
  const { rawBody, signatureHeader, timestampHeader, secret } = input;

  if (!secret) return { ok: false, reason: 'missing_secret' };
  if (!signatureHeader) return { ok: false, reason: 'missing_signature' };
  if (!timestampHeader) return { ok: false, reason: 'missing_timestamp' };

  const timestamp = Number(timestampHeader);
  if (!Number.isFinite(timestamp) || !Number.isInteger(timestamp) || timestamp <= 0) {
    return { ok: false, reason: 'invalid_timestamp' };
  }

  const now = input.nowSeconds ?? Math.floor(Date.now() / 1000);
  const tolerance = input.toleranceSeconds ?? SASPAY_TIMESTAMP_TOLERANCE_SECONDS;
  if (Math.abs(now - timestamp) > tolerance) {
    return { ok: false, reason: 'expired_timestamp' };
  }

  const bodyString = Buffer.isBuffer(rawBody) ? rawBody.toString('utf8') : rawBody;
  const signed = `${timestamp}.${bodyString}`;
  const expected = createHmac('sha256', secret).update(signed).digest('hex');

  // Comparaison en temps constant : les buffers doivent être de même longueur
  // pour que timingSafeEqual ne jette pas.
  const a = Buffer.from(signatureHeader, 'utf8');
  const b = Buffer.from(expected, 'utf8');
  if (a.length !== b.length) return { ok: false, reason: 'signature_mismatch' };
  if (!timingSafeEqual(a, b)) return { ok: false, reason: 'signature_mismatch' };

  return { ok: true };
}

/**
 * Empreinte d'un event pour la dédup persistée. Combine la signature
 * (unique par livraison) et le timestamp (régénéré par chaque re-livraison).
 * On stocke `hex(sha256(...))` plutôt que la signature brute pour ne pas
 * faire d'une table de logs un oracle de signatures.
 */
export function hashSaspayEvent(timestampHeader: string, signatureHeader: string): string {
  return createHmac('sha256', 'saspay-event-dedup')
    .update(`${timestampHeader}.${signatureHeader}`)
    .digest('hex');
}
