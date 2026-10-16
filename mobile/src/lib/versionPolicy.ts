// Politique de version de l'app : logique pure, sans import runtime (testable avec `node --test`).
// Règle : en cas de doute (info absente, incohérente, version installée illisible) on NE bloque PAS —
// une panne serveur ne doit jamais empêcher un client de travailler.

export interface VersionPolicy {
  /** Dernière version publiée. */
  versionCode: number;
  /** Plancher effectif : en dessous, la mise à jour est obligatoire. */
  minVersionCode: number;
  versionName: string;
}

export type VersionDecision = 'ok' | 'update' | 'blocked';

export const VERSION_POLICY_KEY = 'versionPolicy.v1';

const isInt = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v);

/** Valide une réponse serveur ou un cache ; `null` si inutilisable ou incohérente (min > latest). */
export function parsePolicy(raw: unknown): VersionPolicy | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const r = raw as Record<string, unknown>;
  if (!isInt(r.versionCode) || r.versionCode <= 0) return null;
  if (!isInt(r.minVersionCode) || r.minVersionCode < 0) return null;
  if (r.minVersionCode > r.versionCode) return null;
  return {
    versionCode: r.versionCode,
    minVersionCode: r.minVersionCode,
    versionName: typeof r.versionName === 'string' ? r.versionName : '',
  };
}

/**
 * installed < minimum → bloqué ; installed < latest → bannière ; sinon rien.
 * Version installée inconnue ou politique absente → rien.
 */
export function decideVersion(
  installedCode: number | null,
  policy: VersionPolicy | null,
): VersionDecision {
  if (installedCode === null || policy === null) return 'ok';
  if (installedCode < policy.minVersionCode) return 'blocked';
  if (installedCode < policy.versionCode) return 'update';
  return 'ok';
}

/** Réponse serveur fraîche d'abord, sinon dernière politique connue (hors ligne), sinon aucune. */
export function resolvePolicy(
  live: VersionPolicy | null,
  cached: VersionPolicy | null,
): VersionPolicy | null {
  return live ?? cached;
}

export function serializePolicy(policy: VersionPolicy): string {
  return JSON.stringify(policy);
}

export function deserializePolicy(raw: string | null): VersionPolicy | null {
  if (!raw) return null;
  try {
    return parsePolicy(JSON.parse(raw));
  } catch {
    return null;
  }
}
