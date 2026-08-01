import { useCallback, useEffect, useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api, extractErrorMessage } from '@/src/lib/api';
import { useAuth } from '@/src/providers/auth-provider';
import {
  withApi,
  type SystemResource,
} from '@/src/services/mikrotik-lan/MikroTikApiClient';
import { pushWireGuardConfig } from '@/src/services/mikrotik-lan/pushWireGuard';
import {
  getLocalCredentials,
} from '@/src/lib/router-credentials';
import { listActiveLan } from '@/src/services/mikrotik-lan/hotspotLan';
import { getWifiInfo } from '@/src/lib/lanBinder';
import { reportLanSessions } from '@/src/lib/sessionSync';
import { useActiveRouter } from '@/src/providers/active-router-provider';
import {
  Badge,
  Banner,
  Button,
  Card,
  Field,
  IconChip,
  Label,
  Mono,
  Row,
  Screen,
  Subtitle,
  icon,
  radius,
  space,
  theme,
  type,
  type IoniconName,
} from '@/src/components/ui';
import { BottomNav, useBottomNavHeight } from '@/src/components/BottomNav';
import { AppHeader } from '@/src/components/AppHeader';

function memPercent(res: SystemResource): number {
  const rec = res as unknown as Record<string, string>;
  const total = Number(rec['total-memory']);
  const free = Number(rec['free-memory']);
  if (Number.isFinite(total) && total > 0 && Number.isFinite(free)) {
    return Math.round(((total - free) / total) * 100);
  }
  return 0;
}

function Sparkline({
  label,
  value,
  color,
}: {
  label: string;
  value: number;
  color: string;
}) {
  const bars = [20, 35, 15, 40, 25, 18, 22, 30, Math.max(4, Math.min(100, value))];
  return (
    <View
      style={{
        flex: 1,
        backgroundColor: theme.surfaceAlt,
        borderRadius: 14,
        borderWidth: 1,
        borderColor: theme.border,
        padding: 12,
      }}
    >
      <View
        style={{
          flexDirection: 'row',
          justifyContent: 'space-between',
          marginBottom: 6,
        }}
      >
        <Text style={{ color: theme.textMuted, fontSize: 11 }}>{label}</Text>
        <Text style={{ color, fontWeight: '700', fontSize: 12 }}>{value}%</Text>
      </View>
      <View
        style={{ height: 34, flexDirection: 'row', alignItems: 'flex-end', gap: 3 }}
      >
        {bars.map((b, i) => (
          <View
            key={i}
            style={{
              flex: 1,
              height: `${b}%`,
              backgroundColor: color + '66',
              borderRadius: 3,
            }}
          />
        ))}
      </View>
    </View>
  );
}

// The LAN client pins its TCP socket to Wi-Fi; opening it toward an unreachable
// router (mobile data, or a Wi-Fi that isn't the router's) makes
// react-native-tcp-socket throw on a native thread ("No socket with id 0") and
// hard-crashes the app. So only attempt LAN when the router's host is on the
// current Wi-Fi subnet; otherwise go straight to the tunnel.
function sameSubnet24(a: string, b: string): boolean {
  return a.split('.').slice(0, 3).join('.') === b.split('.').slice(0, 3).join('.');
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
  return (
    <Pressable
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
    </Pressable>
  );
}

export default function RouterDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const qc = useQueryClient();
  const { isPro } = useAuth();
  const { selectRouter } = useActiveRouter();
  const navHeight = useBottomNavHeight();

  // Opening a router always activates it: the bottom nav + Maison switch to
  // router-connected mode (mirrors the reference's handleSelectRouter).
  useEffect(() => {
    if (id) void selectRouter(id);
  }, [id, selectRouter]);

  const query = useQuery({
    queryKey: ['router', id],
    queryFn: () => api.routers.get(id),
    enabled: Boolean(id),
  });

  const remoteQuery = useQuery({
    queryKey: ['router-remote', id],
    queryFn: () => api.routers.remoteStatus(id),
    enabled: Boolean(id) && isPro,
  });

  const salesQuery = useQuery({
    queryKey: ['router-metrics', id],
    queryFn: () => api.metrics.summary('30d', id),
    enabled: Boolean(id),
  });

  // "Actifs" doit être un compte live, pas le compteur DB `activeSessions` :
  // ce dernier n'est alimenté que par le sync des routeurs REMOTE. On lit donc
  // en direct, comme le fait déjà l'écran Sessions (LAN pour LOCAL, tunnel pour
  // REMOTE), avec la même garde de sous-réseau que loadLocal ci-dessous.
  // `null` = valeur indisponible (hors du Wi-Fi du routeur) — surtout pas 0,
  // qui affirmerait à tort que personne n'est connecté.
  const activeSessionsQuery = useQuery({
    queryKey: ['router-active-sessions', id, query.data?.mode],
    enabled: Boolean(id) && query.isSuccess,
    queryFn: async (): Promise<number | null> => {
      if (query.data!.mode === 'REMOTE') {
        const list = await api.routers.listSessions(id);
        return list.length;
      }
      const creds = await getLocalCredentials(id);
      if (!creds) return null;
      const wifi = await getWifiInfo();
      const onRouterLan =
        !!wifi &&
        (creds.host === wifi.gateway || sameSubnet24(creds.host, wifi.ipAddress));
      if (!onRouterLan) return null;
      const list = await listActiveLan(creds);
      // Le serveur ne voit pas ce LAN : on lui remonte ce qu'on observe, sans
      // quoi les tickets utilisés ne deviennent jamais du chiffre d'affaires.
      void reportLanSessions(id, list);
      return list.length;
    },
  });

  const plansQuery = useQuery({
    queryKey: ['plans', id],
    queryFn: () => api.plans.list(id),
    enabled: Boolean(id),
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
        text: 'Identifiants enregistrés. Le serveur peut piloter le routeur via le tunnel.',
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
          text: 'Identifiants locaux requis : testez d’abord la connexion LAN.',
        });
        return;
      }
      const bundle = await api.routers.provisionRemote(id);
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
        text: 'Gestion à distance activée. Le routeur est joignable partout.',
      });
    } catch (e) {
      setRemoteMsg({ tone: 'danger', text: extractErrorMessage(e) });
    } finally {
      setRemoteBusy(false);
    }
  }

  async function disableRemote() {
    if (!id) return;
    setRemoteBusy(true);
    setRemoteMsg(null);
    try {
      await api.routers.revokeRemote(id);
      // Opt-out: drop the server-side credentials (they stay on-device for LOCAL).
      await api.routers.update(id, { credentials: null });
      await qc.invalidateQueries({ queryKey: ['router', id] });
      await qc.invalidateQueries({ queryKey: ['router-remote', id] });
      await qc.invalidateQueries({ queryKey: ['routers'] });
      setRemoteMsg({ tone: 'success', text: 'Tunnel désactivé.' });
    } catch (e) {
      setRemoteMsg({ tone: 'danger', text: extractErrorMessage(e) });
    } finally {
      setRemoteBusy(false);
    }
  }

  const [resource, setResource] = useState<SystemResource | null>(null);
  const [resourceVia, setResourceVia] = useState<'lan' | 'remote' | null>(null);
  const [lanState, setLanState] = useState<
    'idle' | 'loading' | 'ok' | 'no-creds' | 'error'
  >('idle');
  const [lanError, setLanError] = useState<string | null>(null);

  const remoteActive = remoteQuery.data?.status === 'ACTIVE';

  const loadLocal = useCallback(async () => {
    if (!id) return;
    setLanState('loading');
    setLanError(null);

    // 1) LAN first: works offline on the router's Wi-Fi (free/local mode). Only
    // when the router is actually on the current Wi-Fi subnet — otherwise the
    // pinned socket crashes the app (see sameSubnet24 above).
    const creds = await getLocalCredentials(id);
    const wifi = await getWifiInfo();
    const onRouterLan =
      !!creds &&
      !!wifi &&
      (creds.host === wifi.gateway || sameSubnet24(creds.host, wifi.ipAddress));
    if (creds && onRouterLan) {
      try {
        setResource(await withApi(creds, (c) => c.systemResource()));
        setResourceVia('lan');
        setLanState('ok');
        return;
      } catch (e) {
        setLanError(extractErrorMessage(e));
      }
    }

    // 2) Remote fallback (PRO): the backend drives the router over the tunnel,
    // so resources are reachable from anywhere the phone has internet.
    if (remoteActive) {
      try {
        setResource(
          (await api.routers.remoteSystemResource(id)) as SystemResource,
        );
        setResourceVia('remote');
        setLanState('ok');
        return;
      } catch (e) {
        setLanError(extractErrorMessage(e));
      }
    }

    setLanState(creds || remoteActive ? 'error' : 'no-creds');
  }, [id, remoteActive]);

  useEffect(() => {
    void loadLocal();
  }, [loadLocal]);

  if (query.isLoading) {
    return (
      <View style={{ flex: 1, backgroundColor: theme.bg }}>
        <AppHeader title="Maison" />
        <Screen>
          <Subtitle>Chargement…</Subtitle>
        </Screen>
      </View>
    );
  }
  if (query.isError || !query.data) {
    return (
      <View style={{ flex: 1, backgroundColor: theme.bg }}>
        <AppHeader title="Maison" />
        <Screen>
          <Banner tone="danger">{extractErrorMessage(query.error)}</Banner>
        </Screen>
      </View>
    );
  }

  const r = query.data;

  return (
    <View style={{ flex: 1, backgroundColor: theme.bg }}>
      <AppHeader title="Maison" />
      <ScrollView
        contentContainerStyle={{
          gap: space.lg,
          padding: space.lg,
          paddingBottom: navHeight,
        }}
      >
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
                <Badge
                  label={
                    r.health === 'ONLINE'
                      ? 'CONNECTÉ'
                      : r.health === 'OFFLINE'
                        ? 'HORS LIGNE'
                        : r.health
                  }
                  tone={
                    r.health === 'ONLINE'
                      ? 'success'
                      : r.health === 'ERROR'
                        ? 'danger'
                        : 'warning'
                  }
                />
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
              <Row style={{ justifyContent: 'flex-start', marginTop: space.xs + 2 }}>
                <Badge
                  label={r.mode === 'REMOTE' ? 'À DISTANCE' : 'LOCAL'}
                  tone={r.mode === 'REMOTE' ? 'gold' : 'secondary'}
                />
              </Row>
            </View>
            <Pressable
              accessibilityLabel="Paramètres du routeur"
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
            </Pressable>
          </Row>
        </Card>

        {lanState === 'ok' && resource ? (
          <Card>
            <Row>
              <Row style={{ gap: space.xs + 2, justifyContent: 'flex-start' }}>
                <Ionicons name="pulse-outline" size={icon.sm} color={theme.secondary} />
                <Label>Moniteur performance</Label>
              </Row>
              <Badge label="EN DIRECT" tone="success" />
            </Row>
            <Row style={{ gap: space.sm + 2, alignItems: 'stretch' }}>
              <Sparkline
                label="CPU"
                value={Number(resource['cpu-load']) || 0}
                color={theme.secondary}
              />
              <Sparkline
                label="Mémoire"
                value={memPercent(resource)}
                color={theme.gold}
              />
            </Row>
          </Card>
        ) : null}

        {lanState === 'error' ? (
          <Banner tone="warning">{lanError ?? 'Routeur injoignable'}</Banner>
        ) : null}

        {/* Accès à distance (réf: carte bleue après le moniteur) */}
        <Card style={{ borderColor: theme.gold + '55' }}>
          <Row>
            <Row style={{ gap: space.xs + 2, justifyContent: 'flex-start' }}>
              <Ionicons name="globe-outline" size={icon.sm} color={theme.gold} />
              <Label>Gestion à distance</Label>
            </Row>
            <Badge label="PRO" tone="gold" />
          </Row>
          {!isPro ? (
            <>
              <Subtitle>
                Réservé au plan PRO. Le pilotage hors du réseau local nécessite un
                abonnement.
              </Subtitle>
              <Button
                title="Voir l’abonnement"
                variant="ghost"
                onPress={() => router.push('/(tabs)/account')}
              />
            </>
          ) : (
            <>
              <Subtitle>
                {remoteQuery.data?.status === 'ACTIVE'
                  ? 'Gestion à distance active — ce routeur est joignable partout.'
                  : 'Activez un tunnel WireGuard sécurisé pour piloter ce routeur à distance.'}
              </Subtitle>
              {remoteMsg ? (
                <Banner tone={remoteMsg.tone}>{remoteMsg.text}</Banner>
              ) : null}
              {remoteQuery.data?.status === 'ACTIVE' ? (
                <Button
                  title="Désactiver le tunnel"
                  variant="danger"
                  onPress={disableRemote}
                  loading={remoteBusy}
                />
              ) : (
                <Button
                  title="Activer le tunnel à distance"
                  onPress={enableRemote}
                  loading={remoteBusy}
                />
              )}

              {remoteQuery.data?.status === 'ACTIVE' ? (
                <>
                  <Button
                    title={
                      showCreds
                        ? 'Masquer les identifiants'
                        : 'Saisir les identifiants RouterOS (hors LAN)'
                    }
                    variant="ghost"
                    onPress={() => setShowCreds((v) => !v)}
                  />
                  {showCreds ? (
                    <>
                      <Subtitle>
                        Le tunnel est déjà en place : renseignez les identifiants
                        du routeur pour restaurer le pilotage à distance, sans
                        être sur son Wi-Fi.
                      </Subtitle>
                      <Field
                        label="Utilisateur RouterOS"
                        value={credUser}
                        onChangeText={setCredUser}
                        autoCapitalize="none"
                      />
                      <Field
                        label="Mot de passe RouterOS"
                        value={credPass}
                        onChangeText={setCredPass}
                        secureTextEntry
                      />
                      <Button
                        title="Enregistrer les identifiants"
                        onPress={saveCredentials}
                        loading={credBusy}
                      />
                    </>
                  ) : null}
                </>
              ) : null}
            </>
          )}
        </Card>

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
            label="Actifs"
            onPress={() =>
              router.push({ pathname: '/sessions', params: { routerId: id } })
            }
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
            label="Utilisés"
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
                  Réseau Wi-Fi
                </Text>
                <Text
                  style={{
                    color: theme.text,
                    fontSize: type.bodyLg,
                    fontWeight: '700',
                    marginTop: 1,
                  }}
                >
                  Hotspot du routeur
                </Text>
              </View>
            </Row>
            <Pressable
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
                Modifier
              </Text>
            </Pressable>
          </Row>
        </Card>

        {/* Cartes astuce — `flex: 1` sur la Card elle-même, pas seulement sur
            le Pressable : sinon `alignItems: stretch` n'étire que le parent et
            les deux cartes finissent à des hauteurs différentes. */}
        <Row style={{ gap: space.md, alignItems: 'stretch' }}>
          <Pressable
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
                  PARTAGE BLOQUÉ
                </Text>
              </Row>
              <Text style={{ color: theme.text, fontSize: type.caption }}>
                Empêcher un client de repartager sa connexion.
              </Text>
              <Text
                style={{
                  color: theme.primary,
                  fontSize: type.micro,
                  fontWeight: '600',
                  marginTop: 'auto',
                }}
              >
                Configurer →
              </Text>
            </Card>
          </Pressable>
          <Pressable
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
                  ANALYSE VENTES
                </Text>
              </Row>
              <Text style={{ color: theme.text, fontSize: type.caption }}>
                Rapport financier & journal de caisse.
              </Text>
              <Text
                style={{
                  color: theme.primary,
                  fontSize: type.micro,
                  fontWeight: '600',
                  marginTop: 'auto',
                }}
              >
                Voir le rapport →
              </Text>
            </Card>
          </Pressable>
        </Row>

        <Button
          title="+ Créer des tickets"
          onPress={() =>
            router.push({
              pathname: '/generate-vouchers',
              params: { routerId: id },
            })
          }
        />
      </ScrollView>
      <BottomNav active="index" />
    </View>
  );
}
