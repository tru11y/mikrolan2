export { ScreenErrorBoundary as ErrorBoundary } from '@/src/components/ScreenErrorBoundary';
import { reportSilent } from '@/src/lib/report';
import { traceRouterEvent } from '@/src/lib/router-events';
import { describeError } from '@/src/lib/errors';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, BackHandler, ScrollView, Text, View } from 'react-native';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, extractErrorMessage } from '@/src/lib/api';
import { useAuth } from '@/src/providers/auth-provider';
import {
  withApi,
  type SystemResource,
} from '@/src/services/mikrotik-lan/MikroTikApiClient';
import { useTranslation } from 'react-i18next';
import { pushWireGuardConfig } from '@/src/services/mikrotik-lan/pushWireGuard';
import { detectServicePorts } from '@/src/services/mikrotik-lan/detectServicePorts';
import {
  getLocalCredentials,
  saveLocalCredentials,
  parseAddress,
} from '@/src/lib/router-credentials';
import { listActiveLan } from '@/src/services/mikrotik-lan/hotspotLan';
import { getWifiInfo, sameSubnet24 } from '@/src/lib/lanBinder';
import { reportLanSessions } from '@/src/lib/sessionSync';
import { useActiveRouter } from '@/src/providers/active-router-provider';
import { useRouterLive } from '@/src/hooks/use-router-live';
import { useSseLive } from '@/src/providers/live-events-provider';
import {
  Badge,
  Banner,
  Button,
  Card,
  Field,
  icon,
  IconChip,
  Label,
  Mono,
  Press,
  radius,
  Row,
  Screen,
  space,
  Subtitle,
  type,
  useToast,
  type IoniconName,
} from '@/src/components/ui';
import { useTheme } from '@/src/providers/theme-provider';
import { BottomNav, useBottomNavHeight } from '@/src/components/BottomNav';
import { AppHeader } from '@/src/components/AppHeader';
import { RouterStatusDot } from '@/src/components/RouterStatusDot';

// Perfs du routeur et sessions actives : 15 s (temps réel ressenti).
const POLL_MS = 15_000;
// Aucun signe de vie pendant ce délai avant de déclarer le routeur hors
// ligne — évite qu'un échec passager bascule l'écran entier.
const OFFLINE_GRACE_MS = 180_000;

function memPercent(res: SystemResource): number {
  const rec = res as unknown as Record<string, string>;
  const total = Number(rec['total-memory']);
  const free = Number(rec['free-memory']);
  if (Number.isFinite(total) && total > 0 && Number.isFinite(free)) {
    return Math.round(((total - free) / total) * 100);
  }
  return 0;
}

// Une jauge, pas un historique : la version précédente dessinait huit barres
// inventées en dur et n'affichait de réel que la dernière valeur.
function Gauge({
  label,
  value,
  color,
}: {
  label: string;
  value: number;
  color: string;
}) {
  const theme = useTheme();
  const pct = Math.max(0, Math.min(100, value));
  return (
    <View
      style={{
        flex: 1,
        backgroundColor: theme.surfaceAlt,
        borderRadius: radius.md,
        padding: space.md,
        gap: space.sm,
      }}
    >
      <Row>
        <Text style={{ color: theme.textMuted, fontSize: type.micro }}>
          {label}
        </Text>
        <Text style={{ color, fontWeight: '700', fontSize: type.caption }}>
          {pct}%
        </Text>
      </Row>
      <View
        style={{
          height: space.sm,
          borderRadius: radius.pill,
          backgroundColor: theme.border,
          overflow: 'hidden',
        }}
      >
        <View
          style={{
            height: '100%',
            width: `${pct}%`,
            borderRadius: radius.pill,
            backgroundColor: color,
          }}
        />
      </View>
    </View>
  );
}

function StatSquare({
  icon: iconName,
  color,
  value,
  label,
  onPress,
}: {
  icon: IoniconName;
  color: string;
  value: string;
  label: string;
  onPress: () => void;
}) {
  // `flex: 1` et non une largeur en pourcentage : quatre tuiles à 23 % dans un
  // Row en space-between laissaient un reliquat réparti dans les gouttières,
  // qui devenaient inégales.
  const theme = useTheme();
  return (
    <Press
      onPress={onPress}
      style={{
        flex: 1,
        backgroundColor: theme.surface,
        borderRadius: radius.lg,
        paddingVertical: space.md,
        paddingHorizontal: space.xs,
        alignItems: 'center',
        gap: space.xs,
      }}
    >
      <IconChip name={iconName} color={color} size="sm" />
      <Text style={{ color: theme.text, fontSize: type.title, fontWeight: '800' }}>
        {value}
      </Text>
      <Text
        style={{ color: theme.textMuted, fontSize: type.micro }}
        numberOfLines={1}
      >
        {label}
      </Text>
    </Press>
  );
}

export default function RouterDetailScreen() {
  const theme = useTheme();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { t } = useTranslation();
  const router = useRouter();
  const qc = useQueryClient();
  const { isPro } = useAuth();
  const { selectRouter } = useActiveRouter();
  const sseLive = useSseLive();
  const navHeight = useBottomNavHeight();
  const toast = useToast();

  // Opening a router always activates it: the bottom nav + Maison switch to
  // router-connected mode (mirrors the reference's handleSelectRouter).
  useEffect(() => {
    if (id) void selectRouter(id);
  }, [id, selectRouter]);

  useFocusEffect(
    useCallback(() => {
      const sub = BackHandler.addEventListener('hardwareBackPress', () => {
        router.navigate('/(tabs)/routeurs');
        return true;
      });
      return () => sub.remove();
    }, [router]),
  );

  const query = useQuery({
    queryKey: ['router', id],
    queryFn: () => api.routers.get(id),
    enabled: Boolean(id),
    refetchInterval: sseLive ? false : POLL_MS,
    placeholderData: keepPreviousData,
  });

  const remoteQuery = useQuery({
    queryKey: ['router-remote', id],
    queryFn: () => api.routers.remoteStatus(id),
    enabled: Boolean(id) && isPro,
    refetchInterval: sseLive ? 30_000 : POLL_MS,
    placeholderData: keepPreviousData,
  });

  const salesQuery = useQuery({
    queryKey: ['router-metrics', id],
    queryFn: () => api.metrics.summary('30d', id),
    enabled: Boolean(id),
    placeholderData: keepPreviousData,
  });

  // "Actifs" doit être un compte live, pas le compteur DB `activeSessions` :
  // ce dernier n'est alimenté que par le sync des routeurs REMOTE. On lit donc
  // en direct, comme le fait déjà l'écran Sessions (LAN pour LOCAL, tunnel pour
  // REMOTE), avec la même garde de sous-réseau que loadLocal ci-dessous.
  // `null` = valeur indisponible (hors du Wi-Fi du routeur) — surtout pas 0,
  // qui affirmerait à tort que personne n'est connecté.
  // Détecte l'absence d'identifiants LAN pour ce routeur LOCAL : sans eux,
  // appareils autorisés et sessions restent muets sans qu'aucun message
  // n'explique pourquoi (voir ip-bindings.tsx / sessions.tsx).
  const localCredsQuery = useQuery({
    queryKey: ['router-local-creds', id],
    queryFn: () => getLocalCredentials(id),
    enabled: Boolean(id) && query.data?.mode === 'LOCAL',
  });
  const missingLocalCreds =
    query.data?.mode === 'LOCAL' &&
    localCredsQuery.isSuccess &&
    !localCredsQuery.data;

  useEffect(() => {
    if (!id || !missingLocalCreds) return;
    (async () => {
      try {
        const remote = await api.routers.getCredentials(id);
        if (remote?.username && remote?.host) {
          const { host, port } = parseAddress(remote.host);
          await saveLocalCredentials(id, { username: remote.username, password: remote.password, host, port });
          qc.invalidateQueries({ queryKey: ['router-local-creds', id] });
        }
      } catch (err) {
        reportSilent('router.sync-credentials', err, { routerId: id });
      }
    })();
  }, [id, missingLocalCreds, qc]);

  const activeSessionsQuery = useQuery({
    queryKey: ['router-active-sessions', id, query.data?.mode],
    // REMOTE : le compteur vient de `useRouterLive` (source unique) — cette
    // requête ne se déclenche plus jamais pour ce mode, elle ne fait double
    // emploi qu'en LOCAL, chemin LAN inchangé.
    enabled: Boolean(id) && query.isSuccess && query.data?.mode !== 'REMOTE',
    refetchInterval: sseLive ? 30_000 : POLL_MS,
    placeholderData: keepPreviousData,
    queryFn: async (): Promise<number | null> => {
      const mode = query.data?.mode;
      if (!mode || mode === 'REMOTE') return null;
      const creds = await getLocalCredentials(id);
      if (!creds) {
        // Pas de credentials locaux : lire le dernier compte synchronisé en DB.
        const synced = await api.routers.listSessions(id);
        return synced.length || null;
      }
      const wifi = await getWifiInfo();
      const onRouterLan =
        !!wifi &&
        (creds.host === wifi.gateway || sameSubnet24(creds.host, wifi.ipAddress));
      if (!onRouterLan) {
        // Hors du Wi-Fi du routeur : dernier compte synchronisé en DB.
        const synced = await api.routers.listSessions(id);
        return synced.length || null;
      }
      const list = await listActiveLan(creds);
      void reportLanSessions(id, list);
      return list.length;
    },
  });

  const plansQuery = useQuery({
    queryKey: ['plans', id],
    queryFn: () => api.plans.list(id),
    enabled: Boolean(id),
    placeholderData: keepPreviousData,
  });

  const [remoteBusy, setRemoteBusy] = useState(false);
  const [remoteMsg, setRemoteMsg] = useState<
    { tone: 'success' | 'danger'; text: string } | null
  >(null);
  const [showCreds, setShowCreds] = useState(false);
  const [credUser, setCredUser] = useState('admin');
  const [credPass, setCredPass] = useState('');
  const [credBusy, setCredBusy] = useState(false);

  // Hand RouterOS credentials to the backend without needing the router's LAN.
  // Only the WireGuard push needs the LAN; storing creds server-side does not.
  // Restores backend access after an APK reinstall wiped the on-device creds,
  // for a router whose tunnel is already provisioned.
  async function saveCredentials() {
    if (!id) return;
    setCredBusy(true);
    setRemoteMsg(null);
    try {
      await api.routers.update(id, {
        credentials: { username: credUser.trim(), password: credPass },
      });
      await qc.invalidateQueries({ queryKey: ['router', id] });
      setShowCreds(false);
      setCredPass('');
      setRemoteMsg({
        tone: 'success',
        text: t('routerDetail.credentialsSaved'),
      });
    } catch (e) {
      setRemoteMsg({ tone: 'danger', text: extractErrorMessage(e) });
    } finally {
      setCredBusy(false);
    }
  }

  async function enableRemote() {
    if (!id) return;
    setRemoteBusy(true);
    setRemoteMsg(null);
    try {
      const creds = await getLocalCredentials(id);
      if (!creds) {
        setRemoteMsg({
          tone: 'danger',
          text: t('routerDetail.localCredsRequired'),
        });
        return;
      }
      // Probe the router's /ip service ports BEFORE provisioning so the VPS
      // DNAT target matches what RouterOS actually listens on. Operators
      // routinely move `www` off 80; without this the tunnel handshakes but
      // WebFig connects to a dead socket and the browser reports RST.
      const servicePorts = await detectServicePorts(creds);
      const bundle = await api.routers.provisionRemote(id, servicePorts);
      await pushWireGuardConfig(creds, bundle);
      // Hand the RouterOS credentials to the backend (encrypted at rest) so the
      // server can drive the router over the tunnel via the binary API (8728).
      // In LOCAL mode they live only on-device; PRO management needs them server-side.
      await api.routers.update(id, {
        credentials: { username: creds.username, password: creds.password },
      });
      await qc.invalidateQueries({ queryKey: ['router', id] });
      await qc.invalidateQueries({ queryKey: ['router-remote', id] });
      await qc.invalidateQueries({ queryKey: ['routers'] });
      setRemoteMsg({
        tone: 'success',
        text: t('routerDetail.remoteEnabled'),
      });
    } catch (e) {
      setRemoteMsg({ tone: 'danger', text: extractErrorMessage(e) });
    } finally {
      setRemoteBusy(false);
    }
  }

  const [resource, setResource] = useState<SystemResource | null>(null);
  const [resourceVia, setResourceVia] = useState<'lan' | 'remote' | null>(null);
  type LanState = 'idle' | 'loading' | 'ok' | 'no-creds' | 'error';
  const [lanState, setLanState] = useState<LanState>('idle');
  const lanStateRef = useRef<LanState>('idle');
  // Horodatage du dernier contact réussi : un routeur n'est déclaré hors
  // ligne qu'après OFFLINE_GRACE_MS sans le moindre signe de vie. Un échec
  // isolé (Wi-Fi qui bascule, paquet perdu, routeur occupé) ne doit pas
  // faire clignoter tout l'écran en « hors ligne » puis revenir.
  const lastSeenRef = useRef<number | null>(null);

  const remoteActive = remoteQuery.data?.status === 'ACTIVE';

  // Source unique REMOTE (CPU/RAM/uptime/sessions), mutualisée côté serveur —
  // remplace l'ancien appel direct `remoteSystemResource` + le polling propre
  // à `router-active-sessions`. Le LAN (ci-dessous) reste inchangé et prioritaire.
  const live = useRouterLive(id, Boolean(id) && remoteActive);

  // ── Mode Diagnostic (durée limitée, actions dangereuses) ──
  const DIAG_DURATION_MS = 5 * 60 * 1000;
  const [diagUntil, setDiagUntil] = useState<number | null>(null);
  const [diagTimeLeft, setDiagTimeLeft] = useState(0);
  const [diagBusy, setDiagBusy] = useState(false);
  const diagActive = diagUntil != null && Date.now() < diagUntil;

  const toggleDiag = useCallback(() => {
    if (diagActive) {
      setDiagUntil(null);
      setDiagTimeLeft(0);
    } else {
      setDiagUntil(Date.now() + DIAG_DURATION_MS);
    }
  }, [diagActive, DIAG_DURATION_MS]);

  useEffect(() => {
    if (!diagUntil) return;
    const tick = () => {
      const left = Math.max(0, diagUntil - Date.now());
      setDiagTimeLeft(left);
      if (left <= 0) {
        setDiagUntil(null);
        toast.error(t('routerDetail.diagnosticExpired'));
      }
    };
    tick();
    const iv = setInterval(tick, 1000);
    return () => clearInterval(iv);
  }, [diagUntil, t, toast]);

  async function diagReboot() {
    Alert.alert(
      t('routerDetail.dangerousAction'),
      t('routerDetail.rebootConfirm1'),
      [
        { text: t('common.cancel'), style: 'cancel' },
        {
          text: t('common.confirm'),
          style: 'destructive',
          onPress: () => {
            Alert.alert(
              t('routerDetail.dangerousAction'),
              t('routerDetail.rebootConfirm2'),
              [
                { text: t('common.cancel'), style: 'cancel' },
                {
                  text: t('routerDetail.rebootRouter'),
                  style: 'destructive',
                  onPress: async () => {
                    setDiagBusy(true);
                    let viaLan = false;
                    try {
                      const creds = await getLocalCredentials(id!);
                      const wifi = await getWifiInfo();
                      const onLan =
                        !!creds &&
                        !!wifi &&
                        (creds.host === wifi.gateway ||
                          sameSubnet24(creds.host, wifi.ipAddress));
                      if (creds && onLan) {
                        viaLan = true;
                        await withApi(creds, (c) => c.reboot());
                      } else if (remoteActive) {
                        await api.routers.rebootRemote(id!);
                      } else {
                        toast.error(t('routerDetail.rebootFailed'));
                        return;
                      }
                      if (viaLan) void traceRouterEvent(id!, 'REBOOT', 'SUCCESS');
                      toast.success(t('routerDetail.rebootSuccess'));
                    } catch (e) {
                      if (viaLan) void traceRouterEvent(id!, 'REBOOT', 'FAILED', e);
                      toast.error(`${t('routerDetail.rebootFailed')} ${describeError(e).message}`);
                    } finally {
                      setDiagBusy(false);
                    }
                  },
                },
              ],
            );
          },
        },
      ],
    );
  }

  async function diagResetHotspot() {
    Alert.alert(
      t('routerDetail.dangerousAction'),
      t('routerDetail.resetHotspotConfirm1'),
      [
        { text: t('common.cancel'), style: 'cancel' },
        {
          text: t('common.confirm'),
          style: 'destructive',
          onPress: () => {
            Alert.alert(
              t('routerDetail.dangerousAction'),
              t('routerDetail.resetHotspotConfirm2'),
              [
                { text: t('common.cancel'), style: 'cancel' },
                {
                  text: t('routerDetail.resetHotspot'),
                  style: 'destructive',
                  onPress: async () => {
                    setDiagBusy(true);
                    try {
                      const creds = await getLocalCredentials(id!);
                      const wifi = await getWifiInfo();
                      const onLan =
                        !!creds &&
                        !!wifi &&
                        (creds.host === wifi.gateway ||
                          sameSubnet24(creds.host, wifi.ipAddress));
                      if (!(creds && onLan)) {
                        void traceRouterEvent(id!, 'HOTSPOT_RESET', 'FAILED', new Error('Routeur hors du LAN du téléphone'));
                        toast.error(t('routerDetail.resetHotspotFailed'));
                        return;
                      }
                      await withApi(creds, async (c) => {
                        const servers = await c.print('/ip/hotspot');
                        for (const s of servers) {
                          if (s['.id']) {
                            await c.set('/ip/hotspot', s['.id'], { disabled: 'yes' });
                          }
                        }
                        for (const s of servers) {
                          if (s['.id']) {
                            await c.set('/ip/hotspot', s['.id'], { disabled: 'no' });
                          }
                        }
                      });
                      void traceRouterEvent(id!, 'HOTSPOT_RESET', 'SUCCESS');
                      toast.success(t('routerDetail.resetHotspotSuccess'));
                    } catch (e) {
                      void traceRouterEvent(id!, 'HOTSPOT_RESET', 'FAILED', e);
                      toast.error(`${t('routerDetail.resetHotspotFailed')} ${describeError(e).message}`);
                    } finally {
                      setDiagBusy(false);
                    }
                  },
                },
              ],
            );
          },
        },
      ],
    );
  }

  const setLanStateSafe = useCallback((next: LanState) => {
    if (lanStateRef.current === next) return;
    lanStateRef.current = next;
    setLanState(next);
  }, []);

  const loadLocal = useCallback(async () => {
    if (!id) return;
    if (lanStateRef.current === 'idle') setLanStateSafe('loading');

    const markReachable = (via: 'lan' | 'remote', res: SystemResource) => {
      setResource(res);
      setResourceVia(via);
      lastSeenRef.current = Date.now();
      setLanStateSafe('ok');
    };

    const creds = await getLocalCredentials(id);
    const wifi = await getWifiInfo();
    const onRouterLan =
      !!creds &&
      !!wifi &&
      (creds.host === wifi.gateway || sameSubnet24(creds.host, wifi.ipAddress));
    if (creds && onRouterLan) {
      try {
        markReachable('lan', await withApi(creds, (c) => c.systemResource()));
        return;
      } catch (e) {
        // Fall through to the remote tunnel, but keep the reason.
        reportSilent('router-detail.lan-probe', e, { routerId: id });
      }
    }

    if (remoteActive) {
      // Géré par `useRouterLive` (source unique, effet de synchronisation
      // ci-dessous) : plus aucune connexion RouterOS indépendante ici.
      return;
    }

    if (!creds && !remoteActive) {
      setLanStateSafe('no-creds');
      return;
    }

    // Période de grâce : on garde le dernier état connu tant qu'on n'a pas
    // dépassé le délai sans contact.
    const lastSeen = lastSeenRef.current;
    if (lastSeen != null && Date.now() - lastSeen < OFFLINE_GRACE_MS) return;
    setLanStateSafe('error');
  }, [id, remoteActive, setLanStateSafe]);

  // Synchronise l'état REMOTE depuis la source unique `useRouterLive` — jamais
  // depuis `loadLocal` (voir ci-dessus, le chemin REMOTE y est un no-op). Le
  // LAN, quand il vient de répondre, reste prioritaire (donnée plus fraîche) :
  // on ne remplace pas un contact LAN récent par une donnée REMOTE plus âgée.
  const liveData = live.data;
  useEffect(() => {
    if (!remoteActive) return;
    if (resourceVia === 'lan' && lastSeenRef.current && Date.now() - lastSeenRef.current < 30_000) return;
    if (liveData) {
      setResource({
        'cpu-load': liveData.cpuPercent != null ? String(liveData.cpuPercent) : '',
        'free-memory':
          liveData.memoryTotalMb != null && liveData.memoryUsedMb != null
            ? String((liveData.memoryTotalMb - liveData.memoryUsedMb) * 1024 * 1024)
            : '',
        'total-memory': liveData.memoryTotalMb != null ? String(liveData.memoryTotalMb * 1024 * 1024) : '',
        uptime: liveData.uptime ?? '',
      } as SystemResource);
      setResourceVia('remote');
      lastSeenRef.current = Date.now() - liveData.ageMs;
      // « stale » (dernière donnée valide, refresh en cours ou en échec passager)
      // reste distinct de « hors ligne » (aucune donnée valide) — §9 du cadrage.
      setLanStateSafe(liveData.health === 'OFFLINE' && !liveData.stale ? 'error' : 'ok');
    } else if (live.isError) {
      const lastSeen = lastSeenRef.current;
      if (lastSeen == null || Date.now() - lastSeen >= OFFLINE_GRACE_MS) setLanStateSafe('error');
    }
  }, [remoteActive, liveData, live.isError, resourceVia, setLanStateSafe]);

  useFocusEffect(
    useCallback(() => {
      void loadLocal();
      const timer = setInterval(() => void loadLocal(), POLL_MS);
      return () => clearInterval(timer);
    }, [loadLocal]),
  );

  if (query.isLoading) {
    return (
      <View style={{ flex: 1, backgroundColor: theme.bg }}>
        <AppHeader title={t('bottomNav.home')} />
        <Screen>
          <Subtitle>{t('common.loading')}</Subtitle>
        </Screen>
      </View>
    );
  }
  if (query.isError || !query.data) {
    return (
      <View style={{ flex: 1, backgroundColor: theme.bg }}>
        <AppHeader title={t('bottomNav.home')} />
        <Screen>
          <Banner tone="danger">{extractErrorMessage(query.error)}</Banner>
        </Screen>
      </View>
    );
  }

  const r = query.data;
  const isOffline = lanState === 'error' || lanState === 'no-creds';
  const probeHealth = lanState === 'ok' ? 'ONLINE' : lanState === 'idle' || lanState === 'loading' ? r.health : 'OFFLINE';

  return (
    <View style={{ flex: 1, backgroundColor: theme.bg }}>
      <AppHeader title={t('bottomNav.home')} />
      <ScrollView
        contentContainerStyle={{
          gap: space.lg,
          padding: space.lg,
          paddingBottom: navHeight,
        }}
      >
        {missingLocalCreds ? (
          <Banner tone="warning">
            <View style={{ gap: space.sm }}>
              <Text style={{ color: theme.text, fontSize: type.body }}>
                {t('routerDetail.missingCredsBanner')}
              </Text>
              <Button
                title={t('routerDetail.addCredentials')}
                variant="ghost"
                onPress={() =>
                  router.push({
                    pathname: '/router-credentials',
                    params: { routerId: id },
                  })
                }
              />
            </View>
          </Banner>
        ) : null}
        <Card>
          <Row style={{ gap: space.md, alignItems: 'flex-start' }}>
            <IconChip name="hardware-chip" size="xl" outlined />
            <View style={{ flex: 1 }}>
              <Row
                style={{
                  justifyContent: 'flex-start',
                  gap: space.sm,
                  flexWrap: 'wrap',
                }}
              >
                <Text
                  style={{ color: theme.text, fontSize: type.title, fontWeight: '800' }}
                >
                  {r.alias || r.identity}
                </Text>
                <RouterStatusDot health={probeHealth} />
              </Row>
              <Mono
                style={{
                  color: theme.textMuted,
                  fontSize: type.caption,
                  marginTop: space.xs - 1,
                }}
              >
                {r.identity}
              </Mono>
              {!isPro ? (
                <Row style={{ justifyContent: 'flex-start', marginTop: space.xs + 2 }}>
                  <Badge
                    label={r.mode === 'REMOTE' ? t('routerDetail.remote') : t('routerDetail.local')}
                    tone={r.mode === 'REMOTE' ? 'gold' : 'secondary'}
                  />
                </Row>
              ) : null}
            </View>
            <Press
              accessibilityLabel={t('routerDetail.routerSettings')}
              onPress={() =>
                router.push({
                  pathname: '/router-settings',
                  params: { routerId: id },
                })
              }
              style={{
                width: 40,
                height: 40,
                borderRadius: radius.md,
                backgroundColor: theme.surfaceAlt,
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <Ionicons name="settings-outline" size={icon.md} color={theme.text} />
            </Press>
          </Row>
        </Card>

        {!isOffline && resource ? (
          <Card>
            <Row style={{ gap: space.xs + 2, justifyContent: 'flex-start' }}>
              <Ionicons name="pulse-outline" size={icon.sm} color={theme.primaryMuted} />
              <Label>{t('routerDetail.performanceMonitor')}</Label>
            </Row>
            {resourceVia === 'remote' && live.ageSec != null ? (
              <Subtitle>
                {live.data?.stale ? '⚠ ' : ''}
                {t('routerDetail.updatedAgo', { s: live.ageSec })}
                {live.data?.refreshing || live.isFetching ? ` · ↻ ${t('routerDetail.refreshing')}` : ''}
                {live.data?.stale ? ` · ${t('routerDetail.dataNotRefreshed')}` : ''}
              </Subtitle>
            ) : null}
            <Row style={{ gap: space.sm + 2, alignItems: 'stretch' }}>
              <Gauge
                label={t('routerDetail.cpu')}
                value={Number(resource['cpu-load']) || 0}
                color={theme.primaryMuted}
              />
              <Gauge
                label={t('routerDetail.memory')}
                value={memPercent(resource)}
                color={theme.gold}
              />
            </Row>
          </Card>
        ) : null}

        {/* Accès à distance — masqué pour PRO (automatique) */}
        {!isPro ? (
          <Card>
            <Row>
              <Row style={{ gap: space.xs + 2, justifyContent: 'flex-start' }}>
                <Ionicons name="globe-outline" size={icon.sm} color={theme.gold} />
                <Label>{t('routerDetail.remoteManagement')}</Label>
              </Row>
              <Badge label={t('routerDetail.proBadge')} tone="gold" />
            </Row>
            <Subtitle>
              {t('routerDetail.remoteManagementDesc')}
            </Subtitle>
            <Button
              title={t('routerDetail.discoverPro')}
              variant="ghost"
              onPress={() => router.push('/(tabs)/account')}
            />
          </Card>
        ) : remoteQuery.data?.status !== 'ACTIVE' ? (
          <Card>
            <Row>
              <Row style={{ gap: space.xs + 2, justifyContent: 'flex-start' }}>
                <Ionicons name="globe-outline" size={icon.sm} color={theme.gold} />
                <Label>{t('routerDetail.remoteManagement')}</Label>
              </Row>
              <Badge label={t('routerDetail.proBadge')} tone="gold" />
            </Row>
            <Subtitle>
              {t('routerDetail.enableTunnel')}
            </Subtitle>
            {remoteMsg ? (
              <Banner tone={remoteMsg.tone}>{remoteMsg.text}</Banner>
            ) : null}
            <Button
              title={t('routerDetail.enableRemote')}
              onPress={enableRemote}
              loading={remoteBusy}
            />
          </Card>
        ) : null}

        {/* Identifiants routeur (PRO avec tunnel actif) */}
        {isPro && remoteQuery.data?.status === 'ACTIVE' ? (
          <>
            {remoteMsg ? (
              <Banner tone={remoteMsg.tone}>{remoteMsg.text}</Banner>
            ) : null}
            {showCreds ? (
              <Card>
                <Label>{t('routerDetail.routerCredentials')}</Label>
                <Subtitle>
                  {t('routerDetail.routerCredentialsDesc')}
                </Subtitle>
                <Field
                  label={t('routerDetail.routerosUser')}
                  value={credUser}
                  onChangeText={setCredUser}
                  autoCapitalize="none"
                />
                <Field
                  label={t('routerDetail.routerosPassword')}
                  value={credPass}
                  onChangeText={setCredPass}
                  secureTextEntry
                />
                <Row style={{ gap: space.sm }}>
                  <View style={{ flex: 1 }}>
                    <Button
                      title={t('common.cancel')}
                      variant="ghost"
                      onPress={() => setShowCreds(false)}
                    />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Button
                      title={t('common.save')}
                      onPress={saveCredentials}
                      loading={credBusy}
                    />
                  </View>
                </Row>
              </Card>
            ) : (
              <Press
                accessibilityLabel={t('routerDetail.editCredentials')}
                onPress={() => setShowCreds(true)}
                style={{ alignSelf: 'flex-start' }}
              >
                <Text
                  style={{
                    color: theme.textMuted,
                    fontSize: type.caption,
                    textDecorationLine: 'underline',
                  }}
                >
                  {t('routerDetail.routerCredentials')}
                </Text>
              </Press>
            )}
          </>
        ) : null}

        {/* Rangée de 4 tuiles carrées (réf) */}
        <Row
          style={{
            gap: space.sm,
            alignItems: 'stretch',
            justifyContent: 'flex-start',
          }}
        >
          <StatSquare
            icon="people"
            color={theme.success}
            value={(() => {
              const n = remoteActive ? live.data?.sessionCount : activeSessionsQuery.data;
              return n == null ? '—' : `${n}`;
            })()}
            label={t('routerDetail.actifs')}
            onPress={() => {
              if (!remoteActive && activeSessionsQuery.isError) {
                const message = extractErrorMessage(activeSessionsQuery.error);
                toast.error(message);
                if (message.includes('Identifiants RouterOS')) setShowCreds(true);
                return;
              }
              router.push({ pathname: '/sessions', params: { routerId: id } });
            }}
          />
          <StatSquare
            icon="ticket"
            color={theme.primary}
            value={`${salesQuery.data?.ticketsGenerated ?? 0}`}
            label={t('home.tickets')}
            onPress={() =>
              router.push({ pathname: '/generate-vouchers', params: { routerId: id } })
            }
          />
          <StatSquare
            icon="layers"
            color={theme.gold}
            value={`${plansQuery.data?.length ?? 0}`}
            label={t('plans.screenTitle')}
            onPress={() =>
              router.push({ pathname: '/plans', params: { routerId: id } })
            }
          />
          <StatSquare
            icon="globe"
            color={theme.primaryMuted}
            value={`${salesQuery.data?.ticketsUsed ?? 0}`}
            label={t('routerDetail.used')}
            onPress={() =>
              router.push({ pathname: '/generate-vouchers', params: { routerId: id } })
            }
          />
        </Row>

        {/* Réseau Sans Fil (SSID) */}
        <Card>
          <Row>
            <Row style={{ gap: space.md, flex: 1, justifyContent: 'flex-start' }}>
              <IconChip name="wifi" size="md" />
              <View style={{ flex: 1 }}>
                <Text style={{ color: theme.textMuted, fontSize: type.caption }}>
                  {t('routerDetail.wifiNetwork')}
                </Text>
                <Text
                  style={{
                    color: theme.text,
                    fontSize: type.bodyLg,
                    fontWeight: '700',
                    marginTop: 1,
                  }}
                >
                  {t('routerDetail.routerHotspot')}
                </Text>
              </View>
            </Row>
            <Press
              onPress={() =>
                router.push({ pathname: '/hotspot-setup', params: { routerId: id } })
              }
            >
              <Text
                style={{
                  color: theme.primaryMuted,
                  fontSize: type.body,
                  fontWeight: '600',
                }}
              >
                {t('common.modify')}
              </Text>
            </Press>
          </Row>
        </Card>

        {/* Cartes astuce — `flex: 1` sur la Card elle-même, pas seulement sur
            le Pressable : sinon `alignItems: stretch` n'étire que le parent et
            les deux cartes finissent à des hauteurs différentes. */}
        <Row style={{ gap: space.md, alignItems: 'stretch' }}>
          <Press
            style={{ flex: 1 }}
            onPress={() =>
              router.push({ pathname: '/internet-sharing', params: { routerId: id } })
            }
          >
            <Card style={{ flex: 1, gap: space.xs + 2 }}>
              <Row style={{ gap: space.xs + 2, justifyContent: 'flex-start' }}>
                <Ionicons name="shield-outline" size={icon.sm} color={theme.warning} />
                <Text
                  style={{
                    color: theme.warning,
                    fontSize: type.micro,
                    fontWeight: '700',
                  }}
                >
                  {t('routerDetail.sharingBlocked')}
                </Text>
              </Row>
              <Text style={{ color: theme.text, fontSize: type.caption }}>
                {t('routerDetail.sharingBlockedDesc')}
              </Text>
              <Text
                style={{
                  color: theme.primary,
                  fontSize: type.micro,
                  fontWeight: '600',
                  marginTop: 'auto',
                }}
              >
                {t('routerDetail.configure')}
              </Text>
            </Card>
          </Press>
          <Press
            style={{ flex: 1 }}
            onPress={() =>
              router.push({ pathname: '/(tabs)/rapport', params: { routerId: id } })
            }
          >
            <Card style={{ flex: 1, gap: space.xs + 2 }}>
              <Row style={{ gap: space.xs + 2, justifyContent: 'flex-start' }}>
                <Ionicons
                  name="trending-up-outline"
                  size={icon.sm}
                  color={theme.primaryMuted}
                />
                <Text
                  style={{
                    color: theme.primaryMuted,
                    fontSize: type.micro,
                    fontWeight: '700',
                  }}
                >
                  {t('routerDetail.salesAnalysis')}
                </Text>
              </Row>
              <Text style={{ color: theme.text, fontSize: type.caption }}>
                {t('routerDetail.salesAnalysisDesc')}
              </Text>
              <Text
                style={{
                  color: theme.primary,
                  fontSize: type.micro,
                  fontWeight: '600',
                  marginTop: 'auto',
                }}
              >
                {t('routerDetail.viewReport')}
              </Text>
            </Card>
          </Press>
        </Row>

        {/* ── Mode Diagnostic ── */}
        <Card>
          <Row>
            <Row style={{ gap: space.xs + 2, justifyContent: 'flex-start' }}>
              <Ionicons
                name="construct-outline"
                size={icon.sm}
                color={diagActive ? theme.warning : theme.textMuted}
              />
              <Label>{t('routerDetail.diagnosticMode')}</Label>
            </Row>
            <Press onPress={toggleDiag}>
              <Badge
                label={diagActive ? t('routerDetail.diagnosticActive') : 'OFF'}
                tone={diagActive ? 'warning' : 'secondary'}
              />
            </Press>
          </Row>
          <Subtitle>{t('routerDetail.diagnosticDesc')}</Subtitle>
          {diagActive ? (
            <View style={{ gap: space.sm }}>
              <Text
                style={{
                  color: theme.warning,
                  fontSize: type.caption,
                  fontWeight: '600',
                  textAlign: 'center',
                }}
              >
                {t('routerDetail.diagnosticTimeLeft', {
                  minutes: Math.floor(diagTimeLeft / 60000),
                  seconds: Math.floor((diagTimeLeft % 60000) / 1000),
                })}
              </Text>
              <Button
                title={t('routerDetail.rebootRouter')}
                variant="ghost"
                onPress={diagReboot}
                loading={diagBusy}
              />
              <Button
                title={t('routerDetail.resetHotspot')}
                variant="ghost"
                onPress={diagResetHotspot}
                loading={diagBusy}
              />
            </View>
          ) : null}
        </Card>

        <Button
          title={t('routerDetail.createTickets')}
          onPress={() =>
            router.push({
              pathname: '/generate-vouchers',
              params: { routerId: id },
            })
          }
        />
        <Button
          title={t('routerDetail.verifyTicket')}
          variant="ghost"
          onPress={() =>
            router.push({ pathname: '/verify-ticket', params: { routerId: id } })
          }
        />
      </ScrollView>
      <BottomNav active="index" />
    </View>
  );
}
