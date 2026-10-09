/**
 * Résolution LAN vérifiée — SANS import runtime (testable avec `node --test`).
 *
 * Deux MikroTik peuvent partager la même adresse (10.10.10.1, 192.168.88.1) : « même sous-réseau »
 * ne prouve PAS que le routeur joint est celui du `routerId` sélectionné. Le pré-check réseau ne
 * produit qu'un CANDIDAT LAN ; seule l'identité RouterOS (`/system/identity`) lue sur ce candidat et
 * comparée à l'identité attendue du routeur donne `VERIFIED`.
 *
 *  NO_CREDS      aucun identifiant local pour ce routeur
 *  NO_LAN        pas de Wi-Fi, ou hôte hors du réseau courant (4G, autre LAN)
 *  UNREACHABLE   candidat LAN qui ne répond pas
 *  MISMATCH      un MikroTik répond mais ce n'est PAS celui de ce routerId
 *  UNVERIFIABLE  identité attendue absente / générique (« MikroTik »…) : jamais traitée comme MATCH
 *  VERIFIED      identité observée = identité attendue
 */
export type LanState = 'NO_CREDS' | 'NO_LAN' | 'UNREACHABLE' | 'MISMATCH' | 'UNVERIFIABLE' | 'VERIFIED';

/**
 * Credentials LAN + identité RouterOS attendue. `withApi` relit `/system/identity` DANS la session qui exécute
 * l'action et refuse si elle diffère : la preuve ne repose jamais sur un cache (TOCTOU Wi-Fi A → B).
 */
export type VerifiedCreds<C> = C & { expectedIdentity: string };

export interface LanRoute<C> {
  state: LanState;
  /** Présent UNIQUEMENT si `state === 'VERIFIED'` : aucune opération LAN sans preuve. */
  creds: VerifiedCreds<C> | null;
  /** Identité RouterOS réellement observée (preuve envoyée au backend pour les rapports LAN). */
  observedIdentity: string | null;
}

export interface LanDeps<C extends { host: string; port?: number }> {
  getCreds(routerId: string): Promise<C | null>;
  getWifi(): Promise<{ gateway: string; ipAddress: string } | null>;
  expectedIdentity(routerId: string): Promise<string | null>;
  /** Lit /system/identity ; rejette si le routeur ne répond pas. */
  readIdentity(creds: C): Promise<string>;
  now(): number;
}

export const TTL_VERIFIED_MS = 60_000;
export const TTL_MISMATCH_MS = 20_000;
export const TTL_UNREACHABLE_MS = 15_000;
export const TTL_UNVERIFIABLE_MS = 15_000;

const GENERIC = /^(mikrotik|routeros|router|default|admin)([-_ ]?\d+)?$/i;

/** Identité par défaut/générique : ne constitue pas une preuve forte. */
export function isGenericIdentity(identity: string | null | undefined): boolean {
  const v = (identity ?? '').trim();
  return v === '' || GENERIC.test(v);
}

/** Refus d'une action LAN : le MikroTik de CETTE session n'est pas (ou n'est pas prouvé être) celui attendu. */
export class LanIdentityMismatchError extends Error {
  readonly reason: 'MISMATCH' | 'UNREADABLE' | 'UNVERIFIABLE';
  constructor(reason: 'MISMATCH' | 'UNREADABLE' | 'UNVERIFIABLE') {
    super(
      reason === 'MISMATCH'
        ? "Le routeur joint n'est pas celui sélectionné : action annulée."
        : "Identité du routeur non vérifiable : action annulée.",
    );
    this.name = 'LanIdentityMismatchError';
    this.reason = reason;
  }
}

/**
 * À appeler dans la session RouterOS qui va exécuter l'action, juste après le login : lit
 * `/system/identity` et refuse (fail closed) si elle est illisible, générique ou différente de l'attendue.
 */
export async function verifySessionIdentity(
  client: { systemIdentity(): Promise<{ name: string }> },
  expectedIdentity: string,
): Promise<void> {
  if (isGenericIdentity(expectedIdentity)) throw new LanIdentityMismatchError('UNVERIFIABLE');
  let observed: string;
  try {
    observed = (await client.systemIdentity()).name.trim();
  } catch {
    throw new LanIdentityMismatchError('UNREADABLE');
  }
  if (observed !== expectedIdentity.trim()) throw new LanIdentityMismatchError('MISMATCH');
}

export function sameSubnet24(a: string, b: string): boolean {
  return a.split('.').slice(0, 3).join('.') === b.split('.').slice(0, 3).join('.');
}

interface CacheEntry {
  state: Exclude<LanState, 'NO_CREDS' | 'NO_LAN'>;
  observedIdentity: string | null;
  expectedIdentity: string | null;
  expiresAt: number;
}

const TTL: Record<CacheEntry['state'], number> = {
  VERIFIED: TTL_VERIFIED_MS,
  MISMATCH: TTL_MISMATCH_MS,
  UNREACHABLE: TTL_UNREACHABLE_MS,
  UNVERIFIABLE: TTL_UNVERIFIABLE_MS,
};

export function createLanResolver<C extends { host: string; port?: number }>(deps: LanDeps<C>) {
  const cache = new Map<string, CacheEntry>();
  const inflight = new Map<string, Promise<LanRoute<C>>>();

  const none = (state: LanState): LanRoute<C> => ({ state, creds: null, observedIdentity: null });

  async function resolve(routerId: string): Promise<LanRoute<C>> {
    const creds = await deps.getCreds(routerId);
    if (!creds) return none('NO_CREDS');

    const wifi = await deps.getWifi();
    if (!wifi) return none('NO_LAN');
    // Pré-check topologique : CANDIDAT seulement, jamais une preuve.
    const candidate = creds.host === wifi.gateway || sameSubnet24(creds.host, wifi.ipAddress);
    if (!candidate) return none('NO_LAN');

    // Clé : routeur + contexte réseau + hôte candidat (changer de Wi-Fi/passerelle = autre clé).
    const key = [routerId, wifi.gateway, wifi.ipAddress, `${creds.host}:${creds.port ?? ''}`].join('|');
    const hit = cache.get(key);
    if (hit && hit.expiresAt > deps.now()) return toRoute(hit, creds);

    const running = inflight.get(key);
    if (running) return running;

    const work = (async (): Promise<LanRoute<C>> => {
      const expected = await deps.expectedIdentity(routerId);
      if (isGenericIdentity(expected)) return remember(key, 'UNVERIFIABLE', null, null, creds);
      let observed: string;
      try {
        observed = (await deps.readIdentity(creds)).trim();
      } catch {
        return remember(key, 'UNREACHABLE', null, null, creds);
      }
      if (observed === (expected as string).trim()) return remember(key, 'VERIFIED', observed, observed, creds);
      return remember(key, 'MISMATCH', observed, null, creds);
    })().finally(() => inflight.delete(key));
    inflight.set(key, work);
    return work;
  }

  function remember(key: string, state: CacheEntry['state'], observed: string | null, expected: string | null, creds: C): LanRoute<C> {
    const entry: CacheEntry = { state, observedIdentity: observed, expectedIdentity: expected, expiresAt: deps.now() + TTL[state] };
    cache.set(key, entry);
    return toRoute(entry, creds);
  }

  function toRoute(entry: CacheEntry, creds: C): LanRoute<C> {
    return {
      state: entry.state,
      creds: entry.state === 'VERIFIED' && entry.expectedIdentity ? { ...creds, expectedIdentity: entry.expectedIdentity } : null,
      observedIdentity: entry.observedIdentity,
    };
  }

  /** Wi-Fi/passerelle changé, retour d'arrière-plan, reconnexion réseau : toutes les preuves sont caduques. */
  function invalidate(): void {
    cache.clear();
  }

  return { resolve, invalidate };
}
