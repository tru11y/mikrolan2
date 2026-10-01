import { useEffect, useState } from 'react';
import { AppState, type AppStateStatus } from 'react-native';
import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, getApiBaseUrl, getAuthTokens, type RouterLiveData } from '@/src/lib/api';
import { openSse, type SseConnection } from '@/src/lib/sse';
import { reportSilent } from '@/src/lib/report';
import { mergeEvent, type RouterLiveEventPayload } from './router-live-merge';

/**
 * Source unique de vérité pour un routeur REMOTE, côté mobile.
 *
 * `['router-live', routerId]` remplace ['router-remote']/['router-active-sessions']/
 * un appel direct à `remoteSystemResource` : tous les écrans qui affichent
 * CPU/RAM/uptime/sessions d'un même routeur lisent désormais ce SEUL cache —
 * l'écran Routeur, l'écran Sessions et un retour de l'un à l'autre ne créent
 * jamais deux sources concurrentes.
 *
 * Le canal SSE `routers/:id/live-events` (RouterGateway, backend figé) met à
 * jour ce cache directement via `setQueryData` — jamais une invalidation qui
 * relance un appel HTTP redondant. Le polling ne sert que de filet quand le
 * flux ne tient pas (même seuil de dégradation que le SSE métier existant).
 */

const FALLBACK_AFTER_ATTEMPTS = 3;
const FALLBACK_POLL_MS = 30_000;

/**
 * `want` n'est volontairement PAS un paramètre de cet appel : React Query ne
 * stocke qu'un seul `queryFn` par `queryKey`, et l'écran Routeur (stats) comme
 * l'écran Sessions (liste) restent montés simultanément (pile de navigation) —
 * deux `queryFn` différentes sur la même clé se feraient concurrence de façon
 * imprévisible. On demande donc toujours `both` : une seule commande RouterOS
 * en plus par refresh mutualisé (le Gateway ne duplique jamais la connexion),
 * et la liste reste chaude pour l'écran Sessions même si lui seul l'affiche.
 */
export function useRouterLive(routerId: string | undefined, enabled: boolean) {
  const qc = useQueryClient();
  const queryKeyString = `router-live|${routerId}`;
  const key = ['router-live', routerId] as const;
  const [sseConnected, setSseConnected] = useState(false);
  const [sseDegraded, setSseDegraded] = useState(false);

  const query = useQuery({
    queryKey: key,
    queryFn: () => api.routers.remoteLive(routerId as string, 'both'),
    enabled: Boolean(routerId) && enabled,
    placeholderData: keepPreviousData,
    // Le SSE tient : pas de sondage. Sinon, filet de 30 s — jamais moins, le
    // backend mutualise déjà, ce n'est pas ce sondage qui protège le routeur.
    refetchInterval: sseConnected && !sseDegraded ? false : FALLBACK_POLL_MS,
  });

  // ── Canal SSE dédié à ce routeur ──────────────────────────
  useEffect(() => {
    if (!routerId || !enabled) {
      setSseConnected(false);
      return;
    }

    let connection: SseConnection | null = null;
    let attempts = 0;

    const authHeaders = (): Record<string, string> => {
      const tokens = getAuthTokens();
      return tokens ? { Authorization: `Bearer ${tokens.accessToken}` } : {};
    };

    function connect() {
      connection?.close();
      connection = openSse({
        url: `${getApiBaseUrl()}/routers/${routerId}/live-events`,
        headers: authHeaders,
        onOpen: () => {
          attempts = 0;
          setSseConnected(true);
          setSseDegraded(false);
        },
        onMessage: (message) => {
          if (message.event === 'HEARTBEAT') return;
          try {
            const event = JSON.parse(message.data) as RouterLiveEventPayload;
            qc.setQueryData<RouterLiveData | undefined>(['router-live', routerId], (prev) => mergeEvent(prev, event));
          } catch (e) {
            reportSilent('router-live.sse-parse', e, { routerId });
          }
        },
        onError: (attempt) => {
          attempts = attempt;
          setSseConnected(false);
          if (attempt >= FALLBACK_AFTER_ATTEMPTS) setSseDegraded(true);
        },
      });
    }

    connect();

    // Arrière-plan : on ferme le flux (pas de connexion inutile en veille) sans
    // toucher au dernier snapshot déjà en cache. Retour au premier plan :
    // reconnexion + au plus un refresh (celui que `useQuery` déclenche déjà à
    // la reprise de focus/réseau, cf. query-provider — rien d'ajouté ici).
    const sub = AppState.addEventListener('change', (state: AppStateStatus) => {
      if (state === 'active') {
        if (!connection) connect();
      } else {
        connection?.close();
        connection = null;
        setSseConnected(false);
      }
    });

    return () => {
      sub.remove();
      connection?.close();
      connection = null;
      void attempts;
    };
  }, [routerId, enabled, qc, queryKeyString]);

  // ── Fraîcheur affichable : âge serveur au moment de la réponse + temps
  // écoulé depuis côté client (jamais l'horloge du serveur, pas de dérive).
  const [nowMs, setNowMs] = useState(Date.now());
  useEffect(() => {
    if (!query.data) return;
    const timer = setInterval(() => setNowMs(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [query.data]);

  const ageSec = query.data
    ? Math.max(0, Math.round((query.data.ageMs + (nowMs - query.dataUpdatedAt)) / 1000))
    : null;

  return { ...query, ageSec, sseConnected };
}
