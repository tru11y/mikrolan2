import { useCallback, useEffect, useRef, useState } from 'react';
import { ScrollView, Text, View } from 'react-native';
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
} from '@/src/lib/router-credentials';
import { listActiveLan } from '@/src/services/mikrotik-lan/hotspotLan';
import { getWifiInfo, sameSubnet24 } from '@/src/lib/lanBinder';
import { reportLanSessions } from '@/src/lib/sessionSync';
import { useActiveRouter } from '@/src/providers/active-router-provider';
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
  routerHealth,
  Row,
  Screen,
  space,
  Subtitle,
  type,
  useToast,
  type IoniconName,
  withAlpha,
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
        borderWidth: 1,
        borderColor: theme.border,
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
        borderWidth: 1,
        borderColor: theme.border,
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
  const navHeight = useBottomNavHeight();
  const toast = useToast();

  // Opening a router always activates it: the bottom nav + Maison switch to
  // router-connected mode (mirrors the reference's handleSelectRouter).
  useEffect(() => {
    if (id) void selectRouter(id);
  }, [id, selectRouter]);

  const query = useQuery({
    queryKey: ['router', id],
    queryFn: () => api.routers.get(id),
    enabled: Boolean(id),
    refetchInterval: POLL_MS,
    placeholderData: keepPreviousData,
  });

  const remoteQuery = useQuery({
    queryKey: ['router-remote', id],
    queryFn: () => api.routers.remoteStatus(id),
    enabled: Boolean(id) && isPro,
    refetchInterval: POLL_MS,
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

  const activeSessionsQuery = useQuery({
    queryKey: ['router-active-sessions', id, query.data?.mode],
    enabled: Boolean(id) && query.isSuccess,
    refetchInterval: POLL_MS,
    placeholderData: keepPreviousData,
    queryFn: async (): Promise<number | null> => {
      const mode = query.data?.mode;
      if (!mode) return null;
      if (mode === 'REMOTE') {
        const list = await api.routers.listSessions(id);
        return list.length;
      }
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
      } catch {
        // fall through to remote
      }
    }

    if (remoteActive) {
      try {
        markReachable(
          'remote',
          (await api.routers.remoteSystemResource(id)) as SystemResource,
        );
        return;
      } catch {
        // fall through to offline
      }
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
                borderWidth: 1,
                borderColor: theme.border,
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
              <Ionicons name="pulse-outline" size={icon.sm} color={theme.secondary} />
              <Label>{t('routerDetail.performanceMonitor')}</Label>
            </Row>
            <Row style={{ gap: space.sm + 2, alignItems: 'stretch' }}>
              <Gauge
                label="CPU"
                value={Number(resource['cpu-load']) || 0}
                color={theme.secondary}
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
          <Card style={{ borderColor: withAlpha(theme.gold, 0.33) }}>
            <Row>
              <Row style={{ gap: space.xs + 2, justifyContent: 'flex-start' }}>
                <Ionicons name="globe-outline" size={icon.sm} color={theme.gold} />
                <Label>{t('routerDetail.remoteManagement')}</Label>
              </Row>
              <Badge label="PRO" tone="gold" />
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
          <Card style={{ borderColor: withAlpha(theme.gold, 0.33) }}>
            <Row>
              <Row style={{ gap: space.xs + 2, justifyContent: 'flex-start' }}>
                <Ionicons name="globe-outline" size={icon.sm} color={theme.gold} />
                <Label>{t('routerDetail.remoteManagement')}</Label>
              </Row>
              <Badge label="PRO" tone="gold" />
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
            value={
              activeSessionsQuery.data == null
                ? '—'
                : `${activeSessionsQuery.data}`
            }
            label={t('routerDetail.actifs')}
            onPress={() => {
              if (activeSessionsQuery.isError) {
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
            label="Tickets"
            onPress={() =>
              router.push({ pathname: '/generate-vouchers', params: { routerId: id } })
            }
          />
          <StatSquare
            icon="layers"
            color={theme.gold}
            value={`${plansQuery.data?.length ?? 0}`}
            label="Plans"
            onPress={() =>
              router.push({ pathname: '/plans', params: { routerId: id } })
            }
          />
          <StatSquare
            icon="globe"
            color={theme.secondary}
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
                  color: theme.secondary,
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
                  color={theme.secondary}
                />
                <Text
                  style={{
                    color: theme.secondary,
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
