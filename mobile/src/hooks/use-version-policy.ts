import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/src/lib/api';
import { describeError } from '@/src/lib/errors';
import { reportSilent } from '@/src/lib/report';
import { getInstalledVersionCode } from '@/src/lib/installedVersion';
import { getStoredValue, setStoredValue } from '@/src/lib/storage';
import { useAuth } from '@/src/providers/auth-provider';
import {
  classifyLatestFailure,
  deserializePolicy,
  evaluateGate,
  parsePolicy,
  serializePolicy,
  VERSION_POLICY_KEY,
  type LatestOutcome,
  type VersionPolicy,
} from '@/src/lib/versionPolicy';

/**
 * Version installée vs dernière / minimale publiées. Même clé de cache que l'écran
 * « Téléchargement de l'application » : une seule requête `/releases/latest`.
 *
 * Fail-open strict : seule une réponse fraîche et valide, avec lien de téléchargement, peut
 * bloquer. Erreur réseau, timeout, 500, réponse invalide ou lien absent → jamais de blocage ;
 * le cache ne produit au plus qu'une bannière. Un 404 (« aucune release ») annule tout.
 * L'endpoint exige une session : le contrôle s'applique dès la connexion.
 */
export function useVersionPolicy() {
  const { isAuthenticated } = useAuth();
  const [cached, setCached] = useState<VersionPolicy | null>(null);

  const installedCode = getInstalledVersionCode();

  useEffect(() => {
    let alive = true;
    getStoredValue(VERSION_POLICY_KEY)
      .then((raw) => {
        if (alive) setCached(deserializePolicy(raw));
      })
      .catch((e) => reportSilent('version-policy.cache-read', e));
    return () => {
      alive = false;
    };
  }, []);

  const query = useQuery({
    queryKey: ['releases', 'latest'],
    queryFn: api.releases.latest,
    enabled: isAuthenticated,
    staleTime: 5 * 60_000,
    retry: 1,
  });

  const live = query.data ? parsePolicy(query.data) : null;
  const liveCode = live?.versionCode;
  const liveMin = live?.minVersionCode;
  const liveName = live?.versionName;

  useEffect(() => {
    if (liveCode === undefined || liveMin === undefined) return;
    const next: VersionPolicy = { versionCode: liveCode, minVersionCode: liveMin, versionName: liveName ?? '' };
    setCached(next);
    setStoredValue(VERSION_POLICY_KEY, serializePolicy(next)).catch((e) =>
      reportSilent('version-policy.cache-write', e),
    );
  }, [liveCode, liveMin, liveName]);

  let latest: LatestOutcome;
  if (query.isError) {
    latest = { kind: classifyLatestFailure(describeError(query.error).status) };
  } else if (query.data) {
    latest = { kind: 'live', policy: live, downloadable: Boolean(query.data.downloadUrl) };
  } else {
    latest = { kind: 'unavailable' };
  }
  const gate = isAuthenticated
    ? evaluateGate(installedCode, latest, cached)
    : { decision: 'ok' as const, policy: null, downloadUnavailable: false, fromCache: false };

  return {
    decision: gate.decision,
    policy: gate.policy,
    installedCode,
    downloadUnavailable: gate.downloadUnavailable,
    isFetching: query.isFetching,
    refetch: query.refetch,
  };
}
