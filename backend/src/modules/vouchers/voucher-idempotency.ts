import { createHash } from 'node:crypto';

/**
 * Fenêtre au-delà de laquelle un VoucherBatch resté `GENERATING` est considéré
 * comme bloqué (serveur mort entre DB et RouterOS, tunnel perdu, etc.). Le
 * timeout métier `remote.run` peut aller jusqu'à `quantity * 3 s` (plafond
 * DTO = 500 → 1 500 s). 1 h laisse la marge sans tolérer un batch orphelin.
 * La réconciliation elle-même reste hors B-01 (appartient à B-03).
 */
export const STALE_GENERATING_THRESHOLD_MS = 3_600_000;

/**
 * Entrée d'empreinte d'une génération de vouchers. L'ordre des champs et le
 * format de sérialisation sont figés : ils font partie du contrat PERSISTANT
 * de `VoucherBatch.requestFingerprint`. Toute évolution devra passer par une
 * nouvelle migration et une invalidation des empreintes stockées.
 */
export interface FingerprintInput {
  tenantId: string;
  routerId: string;
  planId: string;
  quantity: number;
}

/**
 * Canonicalisation stable : JSON.stringify d'un tuple positionnel
 * `[tenantId, routerId, planId, quantity]`. Pas d'ambiguïté de clés (ordre
 * positionnel), pas d'ambiguïté de séparateur (JSON échappe guillemets,
 * virgules et crochets). Hash SHA-256 en hex (64 caractères).
 *
 * Format figé = contrat persistant : ne pas modifier sans migration
 * d'invalidation des empreintes stockées.
 */
export function canonicalFingerprint(input: FingerprintInput): string {
  const tuple = JSON.stringify([input.tenantId, input.routerId, input.planId, input.quantity]);
  return createHash('sha256').update(tuple).digest('hex');
}

/** Hash tronqué d'une clé d'idempotence pour les logs. La clé brute ne sort jamais. */
export function hashIdempotencyKey(key: string): string {
  return createHash('sha256').update(key).digest('hex').slice(0, 16);
}

export function isStaleGenerating(createdAt: Date, now: Date = new Date()): boolean {
  return now.getTime() - createdAt.getTime() > STALE_GENERATING_THRESHOLD_MS;
}

/** Secondes à annoncer au client dans Retry-After pour un batch GENERATING récent. */
export const RETRY_AFTER_SECONDS = 2;

/**
 * Forme du snapshot LAN persisté en JSONB. Strictement limité aux paramètres
 * RouterOS nécessaires au replay LAN. AUCUN secret, credential, token ou code
 * de ticket n'est accepté ici — tout champ supplémentaire est rejeté au
 * moment du parse.
 */
export interface LanPushParamsSnapshot {
  userProfile: string;
  rateLimit?: string;
  sharedUsers?: number;
  limitUptime: string;
  limitBytesTotal?: number;
  comment: string;
}

const ALLOWED_SNAPSHOT_KEYS = new Set([
  'userProfile',
  'rateLimit',
  'sharedUsers',
  'limitUptime',
  'limitBytesTotal',
  'comment',
]);

/**
 * Valide et parse un snapshot JSONB. Retourne `null` si invalide : le service
 * doit alors refuser le replay avec `VOUCHER_REPLAY_SNAPSHOT_MISSING` plutôt
 * que d'inventer des paramètres depuis le Plan courant.
 *
 * Interdit toute clé non listée (ex. `password`, `token`, `apiKey`) : si une
 * version future tente d'enrichir le snapshot sans mettre à jour cette
 * allowlist, le parse échoue et le replay refuse — fail-closed.
 */
export function parseLanPushParamsSnapshot(raw: unknown): LanPushParamsSnapshot | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const obj = raw as Record<string, unknown>;
  for (const key of Object.keys(obj)) {
    if (!ALLOWED_SNAPSHOT_KEYS.has(key)) return null;
  }
  if (typeof obj.userProfile !== 'string' || obj.userProfile.length === 0) return null;
  if (typeof obj.limitUptime !== 'string' || obj.limitUptime.length === 0) return null;
  if (typeof obj.comment !== 'string') return null;
  if (obj.rateLimit !== undefined && typeof obj.rateLimit !== 'string') return null;
  if (obj.sharedUsers !== undefined && typeof obj.sharedUsers !== 'number') return null;
  if (obj.limitBytesTotal !== undefined && typeof obj.limitBytesTotal !== 'number') return null;
  const result: LanPushParamsSnapshot = {
    userProfile: obj.userProfile,
    limitUptime: obj.limitUptime,
    comment: obj.comment,
  };
  if (typeof obj.rateLimit === 'string') result.rateLimit = obj.rateLimit;
  if (typeof obj.sharedUsers === 'number') result.sharedUsers = obj.sharedUsers;
  if (typeof obj.limitBytesTotal === 'number') result.limitBytesTotal = obj.limitBytesTotal;
  return result;
}

/**
 * Nom de l'index unique composite émis par la migration
 * `20261115193605_voucherbatch_idempotency`. Utilisé pour filtrer les P2002
 * et ne pas interpréter comme idempotence une autre violation unique.
 */
export const IDEMPOTENCY_UNIQUE_INDEX_NAME = 'VoucherBatch_tenantId_clientRequestId_key';
export const IDEMPOTENCY_UNIQUE_TARGET_FIELDS = ['tenantId', 'clientRequestId'] as const;

/**
 * Vrai si l'erreur P2002 fournie correspond réellement à l'index d'idempotence.
 * Prisma 5 renseigne `err.meta.target`, qui peut être :
 *   - le nom littéral de l'index (string),
 *   - un tableau de noms de champs (`['tenantId', 'clientRequestId']`),
 *   - une chaîne séparée par virgule.
 * Toute autre forme ou cible différente doit être considérée comme NON liée à
 * notre index : on relance alors l'erreur originale plutôt que de masquer un
 * autre bug (ex. collision sur `Voucher @@unique([tenantId, code])`).
 */
export function isIdempotencyConstraintViolation(meta: unknown): boolean {
  if (!meta || typeof meta !== 'object') return false;
  const target = (meta as { target?: unknown }).target;
  if (typeof target === 'string') {
    if (target === IDEMPOTENCY_UNIQUE_INDEX_NAME) return true;
    const parts = target.split(',').map((s) => s.trim()).filter(Boolean).sort();
    const expected = [...IDEMPOTENCY_UNIQUE_TARGET_FIELDS].sort();
    return parts.length === expected.length && parts.every((p, i) => p === expected[i]);
  }
  if (Array.isArray(target)) {
    const parts = (target.filter((t) => typeof t === 'string') as string[]).map((s) => s.trim()).sort();
    const expected = [...IDEMPOTENCY_UNIQUE_TARGET_FIELDS].sort();
    return parts.length === expected.length && parts.every((p, i) => p === expected[i]);
  }
  return false;
}
