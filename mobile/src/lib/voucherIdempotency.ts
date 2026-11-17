// Cycle de vie des clés d'idempotence côté mobile pour
// POST /routers/:id/vouchers/generate.
//
// Modèle de stockage versionné (AsyncStorage), v2 :
//   {
//     version: 2,
//     intentions: Record<fingerprint, StoredIntention>,
//     recentOrder: string[]                       // MRU, borné à MAX_INTENTIONS
//   }
//
// Une donnée locale absente, expirée, corrompue ou de version inconnue NE prouve
// PAS que le serveur n'a créé aucun batch : dans tous ces cas, on NE crée JAMAIS
// une nouvelle clé automatiquement. L'appelant reçoit un état discriminé et
// déclenche une action humaine (Vérifier dans Fichiers, Contacter le support).
//
// Aucun code voucher, aucun secret, aucune réponse backend complète n'est
// persisté. Les seules métadonnées LAN tolérées sont expectedCount et
// confirmedCount, non sensibles.

export const STORAGE_KEY = 'mikrolan.voucher.idempotency.v2';
/** Version du schéma persisté. Toute valeur différente → UNSUPPORTED_VERSION. */
export const CURRENT_VERSION = 2;
/** Au-delà, l'intention est signalée EXPIRED (pas de rotation automatique). */
export const INTENTION_TTL_MS = 24 * 60 * 60 * 1000;
/** Limite d'intentions conservées. Au-delà : LIMIT_REACHED, pas de suppression auto. */
export const MAX_INTENTIONS = 5;

export interface VoucherIntention {
  routerId: string;
  planId: string;
  quantity: number;
}

export interface LanProgress {
  expectedCount: number;
  confirmedCount: number;
}

export interface StoredIntention extends VoucherIntention {
  key: string;
  createdAt: string; // ISO-8601
  batchId?: string;
  lan?: LanProgress;
}

export interface KeyValueStorage {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
}

export type UuidGenerator = () => string;

const UUID_V4_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ALLOWED_INTENTION_KEYS = new Set(['key', 'routerId', 'planId', 'quantity', 'createdAt', 'batchId', 'lan']);
const ALLOWED_LAN_KEYS = new Set(['expectedCount', 'confirmedCount']);

export function intentionFingerprint(intention: VoucherIntention): string {
  return JSON.stringify([intention.routerId, intention.planId, intention.quantity]);
}

function isValidIntentionShape(value: unknown): value is StoredIntention {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const o = value as Record<string, unknown>;
  for (const k of Object.keys(o)) if (!ALLOWED_INTENTION_KEYS.has(k)) return false;
  if (typeof o.key !== 'string' || !UUID_V4_REGEX.test(o.key)) return false;
  if (typeof o.routerId !== 'string' || o.routerId.length === 0) return false;
  if (typeof o.planId !== 'string' || o.planId.length === 0) return false;
  if (typeof o.quantity !== 'number' || !Number.isInteger(o.quantity) || o.quantity <= 0) return false;
  if (typeof o.createdAt !== 'string' || Number.isNaN(new Date(o.createdAt).getTime())) return false;
  if (o.batchId !== undefined && (typeof o.batchId !== 'string' || o.batchId.length === 0)) return false;
  if (o.lan !== undefined) {
    if (!o.lan || typeof o.lan !== 'object' || Array.isArray(o.lan)) return false;
    const lan = o.lan as Record<string, unknown>;
    for (const k of Object.keys(lan)) if (!ALLOWED_LAN_KEYS.has(k)) return false;
    if (typeof lan.expectedCount !== 'number' || !Number.isInteger(lan.expectedCount) || lan.expectedCount < 0) return false;
    if (typeof lan.confirmedCount !== 'number' || !Number.isInteger(lan.confirmedCount) || lan.confirmedCount < 0) return false;
  }
  return true;
}

export type LoadedState =
  | { kind: 'EMPTY' }
  | { kind: 'CORRUPTED' }
  | { kind: 'UNSUPPORTED_VERSION'; version: unknown }
  | { kind: 'LOADED'; intentions: Record<string, StoredIntention>; recentOrder: string[] };

/**
 * Parse défensif du JSON racine. Jamais de throw. En cas de corruption ou
 * version inconnue, AUCUNE donnée brute corrompue n'est ni retournée ni
 * loggée : seul l'état discriminé est exposé à l'appelant.
 */
export function parseStoredBundle(raw: string | null): LoadedState {
  if (raw === null) return { kind: 'EMPTY' };
  let obj: unknown;
  try {
    obj = JSON.parse(raw);
  } catch {
    return { kind: 'CORRUPTED' };
  }
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return { kind: 'CORRUPTED' };
  const o = obj as Record<string, unknown>;
  if (o.version !== CURRENT_VERSION) {
    return { kind: 'UNSUPPORTED_VERSION', version: o.version };
  }
  if (!o.intentions || typeof o.intentions !== 'object' || Array.isArray(o.intentions)) return { kind: 'CORRUPTED' };
  if (!Array.isArray(o.recentOrder)) return { kind: 'CORRUPTED' };
  const intentionsRaw = o.intentions as Record<string, unknown>;
  const intentions: Record<string, StoredIntention> = {};
  for (const [fp, val] of Object.entries(intentionsRaw)) {
    if (!isValidIntentionShape(val)) return { kind: 'CORRUPTED' };
    intentions[fp] = val;
  }
  const recentOrder: string[] = [];
  for (const v of o.recentOrder) {
    if (typeof v !== 'string') return { kind: 'CORRUPTED' };
    recentOrder.push(v);
  }
  // Toute clé supplémentaire inconnue signale un format inattendu → corrompu.
  const allowedRoot = new Set(['version', 'intentions', 'recentOrder']);
  for (const k of Object.keys(o)) if (!allowedRoot.has(k)) return { kind: 'CORRUPTED' };
  return { kind: 'LOADED', intentions, recentOrder };
}

export type LookupState =
  | { kind: 'EMPTY' }
  | { kind: 'VALID'; intention: StoredIntention }
  | { kind: 'EXPIRED'; intention: StoredIntention }
  | { kind: 'CORRUPTED' }
  | { kind: 'UNSUPPORTED_VERSION'; version: unknown }
  | { kind: 'LIMIT_REACHED'; count: number };

export type EnsureKeyResult =
  | { kind: 'VALID'; intention: StoredIntention }
  | { kind: 'EXPIRED'; intention: StoredIntention }
  | { kind: 'CORRUPTED' }
  | { kind: 'UNSUPPORTED_VERSION'; version: unknown }
  | { kind: 'LIMIT_REACHED'; count: number };

export interface VoucherIdempotencyRepo {
  /** État brut sans ajout d'intention (lecture seule). */
  inspect(now?: Date): Promise<LoadedState>;
  /** Cherche l'état d'une intention précise (sans écrire). */
  lookup(intention: VoucherIntention, now?: Date): Promise<LookupState>;
  /**
   * Retourne la clé associée à l'intention. Ne crée une nouvelle entrée QUE si
   * le bundle est VIDE ou chargé SANS entrée pour cette intention et la limite
   * n'est pas atteinte. Sinon renvoie l'état discriminé — jamais de rotation
   * automatique sur CORRUPTED, EXPIRED, UNSUPPORTED_VERSION ou LIMIT_REACHED.
   */
  ensureKeyFor(intention: VoucherIntention, now?: Date): Promise<EnsureKeyResult>;
  /** Attache un batchId. No-op si clé ne correspond plus. */
  attachBatchId(key: string, batchId: string): Promise<void>;
  /** Met à jour la progression LAN. No-op si clé ne correspond plus. */
  updateLanProgress(key: string, progress: LanProgress): Promise<void>;
  /**
   * Supprime une intention uniquement sous les conditions documentées :
   *   - REMOTE : issue terminale (serveur a tranché).
   *   - LAN : confirmation COMPLÈTE (confirmedCount === expectedCount).
   *   - Toute autre situation : no-op — la suppression doit passer par une
   *     décision humaine explicite via `forceClear`.
   */
  clearIfTerminal(key: string): Promise<boolean>;
  /** Suppression explicite (déclenchée par un acquittement UI). */
  forceClear(key: string): Promise<void>;
}

function emptyBundle(): { version: number; intentions: Record<string, StoredIntention>; recentOrder: string[] } {
  return { version: CURRENT_VERSION, intentions: {}, recentOrder: [] };
}

function bumpRecent(order: string[], fp: string): string[] {
  const without = order.filter((x) => x !== fp);
  without.unshift(fp);
  return without;
}

function isExpired(intention: StoredIntention, now: Date): boolean {
  const created = new Date(intention.createdAt).getTime();
  return now.getTime() - created > INTENTION_TTL_MS;
}

export function createVoucherIdempotencyRepo(
  storage: KeyValueStorage,
  uuid: UuidGenerator,
): VoucherIdempotencyRepo {
  async function load(): Promise<LoadedState> {
    const raw = await storage.getItem(STORAGE_KEY);
    return parseStoredBundle(raw);
  }

  async function writeIntention(
    loaded: Extract<LoadedState, { kind: 'LOADED' }>,
    fp: string,
    intention: StoredIntention,
  ) {
    const intentions = { ...loaded.intentions, [fp]: intention };
    const recentOrder = bumpRecent(loaded.recentOrder, fp);
    const bundle = { version: CURRENT_VERSION, intentions, recentOrder };
    await storage.setItem(STORAGE_KEY, JSON.stringify(bundle));
  }

  return {
    async inspect() {
      return load();
    },

    async lookup(intention, now = new Date()) {
      const state = await load();
      if (state.kind !== 'LOADED') {
        return state.kind === 'EMPTY' ? { kind: 'EMPTY' } : (state as LookupState);
      }
      const fp = intentionFingerprint(intention);
      const existing = state.intentions[fp];
      if (!existing) return { kind: 'EMPTY' };
      if (isExpired(existing, now)) return { kind: 'EXPIRED', intention: existing };
      return { kind: 'VALID', intention: existing };
    },

    async ensureKeyFor(intention, now = new Date()) {
      const state = await load();
      if (state.kind === 'CORRUPTED') return { kind: 'CORRUPTED' };
      if (state.kind === 'UNSUPPORTED_VERSION') {
        return { kind: 'UNSUPPORTED_VERSION', version: state.version };
      }
      const loaded: Extract<LoadedState, { kind: 'LOADED' }> =
        state.kind === 'EMPTY'
          ? { kind: 'LOADED', intentions: {}, recentOrder: [] }
          : state;
      const fp = intentionFingerprint(intention);
      const existing = loaded.intentions[fp];
      if (existing) {
        if (isExpired(existing, now)) {
          // Pas de rotation automatique : on EXIGE une résolution humaine
          // explicite (vérifier le lot, puis forceClear).
          return { kind: 'EXPIRED', intention: existing };
        }
        return { kind: 'VALID', intention: existing };
      }
      // Pas d'entrée pour cette intention. Vérifier la limite avant d'écrire.
      if (Object.keys(loaded.intentions).length >= MAX_INTENTIONS) {
        return { kind: 'LIMIT_REACHED', count: Object.keys(loaded.intentions).length };
      }
      const key = uuid();
      if (!UUID_V4_REGEX.test(key)) {
        throw new Error('voucherIdempotency: UUID generator must produce UUID v4');
      }
      const fresh: StoredIntention = {
        key,
        routerId: intention.routerId,
        planId: intention.planId,
        quantity: intention.quantity,
        createdAt: now.toISOString(),
      };
      await writeIntention(loaded, fp, fresh);
      return { kind: 'VALID', intention: fresh };
    },

    async attachBatchId(key, batchId) {
      const state = await load();
      if (state.kind !== 'LOADED') return;
      for (const [fp, intention] of Object.entries(state.intentions)) {
        if (intention.key === key) {
          const next: StoredIntention = { ...intention, batchId };
          await writeIntention(state, fp, next);
          return;
        }
      }
    },

    async updateLanProgress(key, progress) {
      if (progress.confirmedCount > progress.expectedCount) return; // défensif
      const state = await load();
      if (state.kind !== 'LOADED') return;
      for (const [fp, intention] of Object.entries(state.intentions)) {
        if (intention.key === key) {
          const next: StoredIntention = { ...intention, lan: { ...progress } };
          await writeIntention(state, fp, next);
          return;
        }
      }
    },

    async clearIfTerminal(key) {
      const state = await load();
      if (state.kind !== 'LOADED') return false;
      for (const [fp, intention] of Object.entries(state.intentions)) {
        if (intention.key !== key) continue;
        const lan = intention.lan;
        // LAN partiel : jamais de clear automatique.
        if (lan && lan.confirmedCount < lan.expectedCount) return false;
        // Terminal (REMOTE ou LAN complet). On supprime.
        const nextIntentions = { ...state.intentions };
        delete nextIntentions[fp];
        const nextOrder = state.recentOrder.filter((x) => x !== fp);
        const bundle = { version: CURRENT_VERSION, intentions: nextIntentions, recentOrder: nextOrder };
        await storage.setItem(STORAGE_KEY, JSON.stringify(bundle));
        return true;
      }
      return false;
    },

    async forceClear(key) {
      const state = await load();
      if (state.kind !== 'LOADED') return;
      for (const [fp, intention] of Object.entries(state.intentions)) {
        if (intention.key !== key) continue;
        const nextIntentions = { ...state.intentions };
        delete nextIntentions[fp];
        const nextOrder = state.recentOrder.filter((x) => x !== fp);
        const bundle = { version: CURRENT_VERSION, intentions: nextIntentions, recentOrder: nextOrder };
        await storage.setItem(STORAGE_KEY, JSON.stringify(bundle));
        return;
      }
    },
  };
}

/**
 * Codes d'erreur backend après lesquels on NE DOIT PAS générer de nouvelle clé
 * automatiquement : l'état doit être réconcilié avant toute nouvelle tentative.
 */
export const BLOCKING_SERVER_ERROR_CODES = new Set([
  'VOUCHER_GENERATION_STALE',
  'VOUCHER_REPLAY_SNAPSHOT_MISSING',
]);

export function isBlockingServerError(errorCode: string | undefined | null): boolean {
  if (!errorCode) return false;
  return BLOCKING_SERVER_ERROR_CODES.has(errorCode);
}

/**
 * Retry-After parsing — borne [RETRY_AFTER_MIN_S, RETRY_AFTER_MAX_S].
 * Toute valeur invalide / négative / excessive → RETRY_AFTER_FALLBACK_S.
 */
export const RETRY_AFTER_MIN_S = 1;
export const RETRY_AFTER_MAX_S = 60;
export const RETRY_AFTER_FALLBACK_S = 2;

export function parseRetryAfterSeconds(raw: string | null | undefined): number {
  if (raw === undefined || raw === null) return RETRY_AFTER_FALLBACK_S;
  const trimmed = raw.trim();
  if (trimmed.length === 0) return RETRY_AFTER_FALLBACK_S;
  const n = Number(trimmed);
  if (!Number.isFinite(n) || !Number.isInteger(n) || n < RETRY_AFTER_MIN_S) {
    return RETRY_AFTER_FALLBACK_S;
  }
  if (n > RETRY_AFTER_MAX_S) return RETRY_AFTER_MAX_S;
  return n;
}
