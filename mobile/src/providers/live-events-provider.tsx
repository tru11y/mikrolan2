import {
  createContext,
  PropsWithChildren,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from 'react';
import { AppState, AppStateStatus, Vibration } from 'react-native';
import { useQueryClient } from '@tanstack/react-query';
import { api, getApiBaseUrl, getAuthTokens } from '@/src/lib/api';
import { openSse, type SseConnection } from '@/src/lib/sse';
import { useAuth } from '@/src/providers/auth-provider';
import { useToast } from '@/src/components/ui';

/**
 * Fil des évènements de l'exploitation, en direct.
 *
 * L'application sondait `/notifications` en boucle et se contentait de changer
 * un badge : personne ne le voyait, et l'opérateur apprenait qu'un ticket avait
 * été activé en ouvrant l'écran des notifications.
 *
 * Le serveur pousse désormais ses évènements (`GET /api/events/stream`, SSE).
 * Ce provider les remonte à l'écran quel que soit l'écran affiché, et
 * rafraîchit les chiffres qui en dépendent. Le sondage subsiste comme filet :
 * un proxy ou un pare-feu qui casse les connexions longues ne doit pas rendre
 * l'application aveugle.
 */

type LiveEventType =
  | 'VOUCHER_ACTIVATED'
  | 'SESSION_ENDED'
  | 'SUBSCRIPTION_ACTIVATED'
  | 'UPGRADE_REQUESTED'
  | 'ROUTER_OFFLINE'
  | 'ROUTER_ONLINE'
  | 'HEARTBEAT';

interface LiveEvent {
  id: number;
  type: LiveEventType;
  at: string;
  title: string;
  body: string;
  data: Record<string, string | number | null>;
}

/** Nombre d'échecs consécutifs à partir duquel on repasse au sondage. */
const FALLBACK_AFTER_ATTEMPTS = 3;
const FALLBACK_POLL_MS = 15_000;

type LiveEventsValue = {
  /** Date du dernier évènement reçu, pour un indicateur d'activité. */
  lastEventAt: Date | null;
  /** Le flux est ouvert (par opposition au repli par sondage). */
  live: boolean;
};

const LiveEventsContext = createContext<LiveEventsValue>({
  lastEventAt: null,
  live: false,
});

/** Les évènements qui méritent d'interrompre l'utilisateur. */
const ANNOUNCED: Partial<Record<LiveEventType, 'success' | 'danger' | 'info'>> = {
  SUBSCRIPTION_ACTIVATED: 'success',
  ROUTER_OFFLINE: 'danger',
  UPGRADE_REQUESTED: 'info',
};

export function LiveEventsProvider({ children }: PropsWithChildren) {
  const { isAuthenticated, me, entitlement, refreshProfile } = useAuth();
  const toast = useToast();
  const qc = useQueryClient();

  const [lastEventAt, setLastEventAt] = useState<Date | null>(null);
  const [live, setLive] = useState(false);
  const [degraded, setDegraded] = useState(false);

  const lastEventId = useRef<string | null>(null);
  const previousTier = useRef<typeof entitlement.tier | null>(null);
  const isSuperAdmin = me?.user.role === 'SUPER_ADMIN';

  const handleEvent = useCallback(
    (event: LiveEvent) => {
      if (event.type === 'HEARTBEAT') return;
      setLastEventAt(new Date());

      const tone = ANNOUNCED[event.type];
      if (tone) {
        Vibration.vibrate(event.type === 'ROUTER_OFFLINE' ? 80 : 40);
        const text = event.body ? `${event.title} — ${event.body}` : event.title;
        toast.show(text.length > 120 ? `${text.slice(0, 119)}…` : text, tone);
      }

      // Un ticket qui s'active change le CA, les sessions et l'état du lot ;
      // une demande d'activation change la file du back-office.
      const keys: string[][] = [['notifications']];
      if (event.type === 'VOUCHER_ACTIVATED' || event.type === 'SESSION_ENDED') {
        keys.push(['metrics'], ['sessions'], ['vouchers']);
      }
      if (event.type === 'SUBSCRIPTION_ACTIVATED') {
        keys.push(['subscription']);
        void refreshProfile().catch(() => {});
      }
      if (event.type === 'UPGRADE_REQUESTED') keys.push(['admin']);
      if (event.type === 'ROUTER_OFFLINE' || event.type === 'ROUTER_ONLINE') {
        keys.push(['routers'], ['router']);
      }
      for (const queryKey of keys) void qc.invalidateQueries({ queryKey });
    },
    [qc, refreshProfile, toast],
  );

  /**
   * Le traitement des évènements est lu à travers une référence, jamais placé
   * dans les dépendances de l'effet ci-dessous.
   *
   * `handleEvent` change d'identité dès que le contexte d'authentification est
   * recalculé (il capture `refreshProfile`). Le mettre en dépendance faisait
   * fermer puis rouvrir la connexion à chaque re-rendu : sur le téléphone,
   * OkHttp annulait la requête ~2 ms après l'avoir ouverte
   * (« reading: context canceled » côté Caddy), le flux ne tenait jamais et
   * l'application basculait sur le sondage de secours sans le dire.
   *
   * Une connexion réseau longue ne doit dépendre que de ce qui la rend
   * réellement caduque : l'identité de l'utilisateur.
   */
  const handleEventRef = useRef(handleEvent);
  useEffect(() => {
    handleEventRef.current = handleEvent;
  }, [handleEvent]);

  // ── Flux serveur ────────────────────────────────────────
  useEffect(() => {
    if (!isAuthenticated) {
      setLive(false);
      lastEventId.current = null;
      return;
    }

    const connections: SseConnection[] = [];
    const authHeaders = (): Record<string, string> => {
      const tokens = getAuthTokens();
      return tokens ? { Authorization: `Bearer ${tokens.accessToken}` } : {};
    };

    function connect() {
      connections.push(
        openSse({
          url: `${getApiBaseUrl()}/events/stream`,
          headers: authHeaders,
          lastEventId: () => lastEventId.current,
          onOpen: () => {
            setLive(true);
            setDegraded(false);
          },
          onMessage: (message) => {
            try {
              const event = JSON.parse(message.data) as LiveEvent;
              // Le curseur de reprise vient de la charge utile, pas de la
              // ligne `id:` du flux : NestJS y écrit son propre compteur de
              // messages, qui n'a rien à voir avec la numérotation du canal
              // (un battement de cœur sans id ressort quand même en « id: 1 »).
              if (typeof event.id === 'number' && event.id >= 0) {
                lastEventId.current = String(event.id);
              }
              handleEventRef.current(event);
            } catch {
              // Charge utile illisible : on ignore plutôt que de faire tomber
              // le flux entier pour un message malformé.
            }
          },
          onError: (attempt) => {
            setLive(false);
            if (attempt >= FALLBACK_AFTER_ATTEMPTS) setDegraded(true);
          },
        }),
      );

      // Le canal plateforme n'existe que pour l'administration : c'est là
      // qu'arrivent les demandes d'activation, pas sur le canal du compte.
      if (isSuperAdmin) {
        connections.push(
          openSse({
            url: `${getApiBaseUrl()}/events/platform`,
            headers: authHeaders,
            onMessage: (message) => {
              try {
                handleEventRef.current(JSON.parse(message.data) as LiveEvent);
              } catch {
                // idem
              }
            },
          }),
        );
      }
    }

    function closeAll() {
      for (const c of connections.splice(0)) c.close();
      setLive(false);
    }

    connect();

    // Écran éteint : on ferme. Garder un socket ouvert en arrière-plan vide la
    // batterie et le système finit par le couper de toute façon.
    const sub = AppState.addEventListener('change', (state: AppStateStatus) => {
      if (state === 'active') {
        if (connections.length === 0) connect();
      } else {
        closeAll();
      }
    });

    return () => {
      sub.remove();
      closeAll();
    };
  }, [isAuthenticated, isSuperAdmin]);

  // ── Filet de sécurité ───────────────────────────────────
  // N'entre en jeu que si le flux ne tient pas : réseau qui coupe les
  // connexions longues, proxy trop zélé.
  useEffect(() => {
    if (!isAuthenticated || !degraded) return;
    const seen = new Set<string>();
    let primed = false;

    async function tick() {
      if (AppState.currentState !== 'active') return;
      try {
        const list = await api.notifications.list(false, 20);
        if (!primed) {
          for (const n of list) seen.add(n.id);
          primed = true;
          return;
        }
        const fresh = list.filter((n) => !seen.has(n.id));
        for (const n of list) seen.add(n.id);
        if (!fresh.length) return;
        setLastEventAt(new Date());
        Vibration.vibrate(40);
        toast.show(
          fresh.length === 1
            ? `${fresh[0].title} — ${fresh[0].body}`
            : `${fresh.length} nouvelles connexions clients.`,
          'success',
        );
        await qc.invalidateQueries({ queryKey: ['notifications'] });
        await qc.invalidateQueries({ queryKey: ['metrics'] });
      } catch {
        // Réseau coupé : on retentera au prochain tour.
      }
    }

    void tick();
    const id = setInterval(tick, FALLBACK_POLL_MS);
    return () => clearInterval(id);
  }, [degraded, isAuthenticated, qc, toast]);

  // Le basculement de l'abonnement est le seul évènement de paiement
  // observable côté client : c'est lui qui confirme que le versement est passé.
  // Ne PAS déclencher au premier render : previousTier est null tant que
  // l'entitlement n'a pas été chargé une première fois, sinon un simple
  // rechargement de session (async: FREE → PRO) affiche "Paiement validé".
  useEffect(() => {
    const now = me?.entitlement?.tier;
    if (!now) return;
    const before = previousTier.current;
    previousTier.current = now;
    if (before === null || before === now) return;

    if (now === 'PRO') {
      Vibration.vibrate([0, 60, 80, 60]);
      toast.success('Paiement validé — votre abonnement PRO est actif.');
      setLastEventAt(new Date());
    } else if (now === 'LOCKED') {
      toast.show('Votre période d\'essai est terminée.', 'danger');
    }
  }, [me?.entitlement?.tier, toast]);

  return (
    <LiveEventsContext.Provider value={{ lastEventAt, live }}>
      {children}
    </LiveEventsContext.Provider>
  );
}

export function useLiveEvents(): LiveEventsValue {
  return useContext(LiveEventsContext);
}
