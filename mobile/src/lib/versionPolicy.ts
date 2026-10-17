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

/** Résultat de `/releases/latest` tel que le garde le comprend. */
export type LatestOutcome =
  | { kind: 'live'; policy: VersionPolicy | null; downloadable: boolean }
  | { kind: 'no-release' }
  | { kind: 'unavailable' };

/**
 * Erreur de `/releases/latest` → 404 « aucune release » (annule tout) ou « indisponible »
 * (500, timeout, réseau, erreur inconnue : on ne sait pas, donc on ne bloque pas).
 */
export function classifyLatestFailure(status: number | null): 'no-release' | 'unavailable' {
  return status === 404 ? 'no-release' : 'unavailable';
}

export interface GateResult {
  decision: VersionDecision;
  policy: VersionPolicy | null;
  /** Mise à jour requise ou disponible, mais le serveur ne fournit pas de lien de téléchargement. */
  downloadUnavailable: boolean;
  fromCache: boolean;
}

/**
 * Fail-open strict : le blocage exige une réponse serveur FRAÎCHE, valide, avec un lien de
 * téléchargement. Sans lien, retour à « mise à jour disponible » (jamais d'utilisateur coincé).
 * Le cache ne peut produire qu'une bannière, jamais un blocage.
 */
export function evaluateGate(
  installedCode: number | null,
  latest: LatestOutcome,
  cached: VersionPolicy | null,
): GateResult {
  if (latest.kind === 'no-release') {
    return { decision: 'ok', policy: null, downloadUnavailable: false, fromCache: false };
  }
  if (latest.kind === 'live' && latest.policy !== null) {
    const base = decideVersion(installedCode, latest.policy);
    const decision = base === 'blocked' && !latest.downloadable ? 'update' : base;
    return {
      decision,
      policy: latest.policy,
      downloadUnavailable: decision !== 'ok' && !latest.downloadable,
      fromCache: false,
    };
  }
  // Erreur, indisponibilité ou réponse invalide : dernière politique connue, plafonnée à la bannière.
  const base = decideVersion(installedCode, cached);
  return {
    decision: base === 'blocked' ? 'update' : base,
    policy: cached,
    downloadUnavailable: false,
    fromCache: cached !== null,
  };
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
