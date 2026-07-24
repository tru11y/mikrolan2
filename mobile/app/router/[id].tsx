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
  deleteLocalCredentials,
  getLocalCredentials,
} from '@/src/lib/router-credentials';
import { getWifiInfo } from '@/src/lib/lanBinder';
import {
  Badge,
  Banner,
  Button,
  Card,
  Field,
  Label,
  Mono,
  Row,
  Screen,
  Subtitle,
  theme,
  type IoniconName,
} from '@/src/components/ui';
import { BottomNav } from '@/src/components/BottomNav';

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

function MetricCell({
  icon,
  label,
  value,
}: {
  icon: IoniconName;
  label: string;
  value: string;
}) {
  return (
    <View
      style={{
        width: '48%',
        backgroundColor: theme.surfaceAlt,
        borderRadius: 14,
        padding: 14,
        gap: 6,
      }}
    >
      <Ionicons name={icon} size={18} color={theme.secondary} />
      <Text style={{ color: theme.textMuted, fontSize: 11 }}>{label}</Text>
      <Text
        style={{
          color: theme.text,
          fontFamily: theme.mono,
          fontSize: 15,
          fontWeight: '700',
        }}
      >
        {value}
      </Text>
    </View>
  );
}

function ActionCell({
  icon,
  label,
  color,
  onPress,
}: {
  icon: IoniconName;
  label: string;
  color: string;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      style={{
        width: '48%',
        borderWidth: 1,
        borderColor: theme.border,
        backgroundColor: theme.surface,
        borderRadius: 14,
        paddingVertical: 18,
        alignItems: 'center',
        gap: 8,
      }}
    >
      <Ionicons name={icon} size={22} color={color} />
      <Text style={{ color: theme.text, fontWeight: '600', fontSize: 13 }}>
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
        text: `Tunnel activé — IP ${bundle.wgIp}. Le routeur est joignable à distance.`,
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

  const [alias, setAlias] = useState('');
  const [resource, setResource] = useState<SystemResource | null>(null);
  const [resourceVia, setResourceVia] = useState<'lan' | 'remote' | null>(null);
  const [lanState, setLanState] = useState<
    'idle' | 'loading' | 'ok' | 'no-creds' | 'error'
  >('idle');
  const [lanError, setLanError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (query.data) setAlias(query.data.alias ?? '');
  }, [query.data]);

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

  async function saveAlias() {
    if (!id) return;
    setBusy(true);
    setError(null);
    try {
      await api.routers.update(id, { alias: alias.trim() || null });
      await qc.invalidateQueries({ queryKey: ['router', id] });
      await qc.invalidateQueries({ queryKey: ['routers'] });
    } catch (e) {
      setError(extractErrorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (!id) return;
    setBusy(true);
    setError(null);
    try {
      await api.routers.remove(id);
      await deleteLocalCredentials(id);
      await qc.invalidateQueries({ queryKey: ['routers'] });
      router.back();
    } catch (e) {
      setError(extractErrorMessage(e));
      setBusy(false);
    }
  }

  if (query.isLoading) {
    return (
      <Screen>
        <Subtitle>Chargement…</Subtitle>
      </Screen>
    );
  }
  if (query.isError || !query.data) {
    return (
      <Screen>
        <Banner tone="danger">{extractErrorMessage(query.error)}</Banner>
      </Screen>
    );
  }

  const r = query.data;

  return (
    <View style={{ flex: 1, backgroundColor: theme.bg }}>
      <ScrollView contentContainerStyle={{ gap: 16, padding: 16, paddingBottom: 100 }}>
        <Card>
          <Row style={{ gap: 12, alignItems: 'flex-start' }}>
            <View
              style={{
                width: 56,
                height: 56,
                borderRadius: 16,
                backgroundColor: theme.primary + '22',
                borderWidth: 1,
                borderColor: theme.primary + '44',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <Ionicons name="hardware-chip" size={28} color={theme.primary} />
            </View>
            <View style={{ flex: 1 }}>
              <Row style={{ justifyContent: 'flex-start', gap: 8, flexWrap: 'wrap' }}>
                <Text style={{ color: theme.text, fontSize: 18, fontWeight: '800' }}>
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
              <Mono style={{ color: theme.textMuted, fontSize: 12, marginTop: 3 }}>
                {r.identity}
                {r.localAddress ? ` · ${r.localAddress}` : ''}
              </Mono>
              <Row style={{ justifyContent: 'flex-start', marginTop: 6 }}>
                <Badge
                  label={r.mode === 'REMOTE' ? 'À DISTANCE' : 'LOCAL'}
                  tone={r.mode === 'REMOTE' ? 'gold' : 'secondary'}
                />
              </Row>
            </View>
          </Row>
        </Card>

        {lanState === 'ok' && resource ? (
          <Card>
            <Row>
              <Row style={{ gap: 6, justifyContent: 'flex-start' }}>
                <Ionicons name="pulse-outline" size={16} color={theme.secondary} />
                <Label>Moniteur performance</Label>
              </Row>
              <Badge label="API 8728" tone="success" />
            </Row>
            <Row style={{ gap: 10, alignItems: 'stretch' }}>
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

        {error ? <Banner tone="danger">{error}</Banner> : null}

        <Card>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
            <Label>État local (LAN)</Label>
            {lanState === 'ok' && resourceVia ? (
              <Badge
                label={resourceVia === 'remote' ? 'Via tunnel' : 'LAN'}
                tone={resourceVia === 'remote' ? 'gold' : 'muted'}
              />
            ) : null}
          </View>
          {lanState === 'loading' ? <Subtitle>Connexion au routeur…</Subtitle> : null}
          {lanState === 'no-creds' ? (
            <Subtitle>
              Aucun identifiant local enregistré sur cet appareil.
            </Subtitle>
          ) : null}
          {lanState === 'error' ? (
            <Banner tone="warning">{lanError ?? 'Routeur injoignable'}</Banner>
          ) : null}
          {lanState === 'ok' && resource ? (
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10 }}>
              <MetricCell
                icon="shield-checkmark-outline"
                label="RouterOS"
                value={resource.version}
              />
              <MetricCell
                icon="hardware-chip-outline"
                label="Modèle"
                value={resource['board-name']}
              />
              <MetricCell
                icon="time-outline"
                label="Uptime"
                value={resource.uptime}
              />
              <MetricCell
                icon="ellipse-outline"
                label="Mémoire libre"
                value={resource['free-memory']}
              />
            </View>
          ) : null}
          <Button
            title="Rafraîchir"
            variant="ghost"
            onPress={loadLocal}
            loading={lanState === 'loading'}
          />
        </Card>

        <Card>
          <Label>Ventes (30 jours)</Label>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10 }}>
            <MetricCell
              icon="cash-outline"
              label="Revenu"
              value={`${(salesQuery.data?.revenueXof ?? 0).toLocaleString('fr-FR')} F`}
            />
            <MetricCell
              icon="ticket-outline"
              label="Tickets vendus"
              value={`${salesQuery.data?.ticketsGenerated ?? 0}`}
            />
            <MetricCell
              icon="people-outline"
              label="Utilisés"
              value={`${salesQuery.data?.ticketsUsed ?? 0}`}
            />
            <MetricCell
              icon="pulse-outline"
              label="Sessions actives"
              value={`${salesQuery.data?.activeSessions ?? 0}`}
            />
          </View>
        </Card>

        <Card>
          <Label>Actions rapides</Label>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10 }}>
            <ActionCell
              icon="pricetags-outline"
              label="Forfaits"
              color={theme.primary}
              onPress={() =>
                router.push({ pathname: '/plans', params: { routerId: id } })
              }
            />
            <ActionCell
              icon="ticket-outline"
              label="Générer tickets"
              color={theme.primary}
              onPress={() =>
                router.push({
                  pathname: '/generate-vouchers',
                  params: { routerId: id },
                })
              }
            />
            <ActionCell
              icon="people-outline"
              label="Sessions"
              color={theme.secondary}
              onPress={() =>
                router.push({ pathname: '/sessions', params: { routerId: id } })
              }
            />
            <ActionCell
              icon="globe-outline"
              label="Portail captif"
              color={theme.secondary}
              onPress={() =>
                router.push({
                  pathname: '/hotspot-setup',
                  params: { routerId: id },
                })
              }
            />
          </View>
        </Card>

        <Card>
          <Field label="Alias" value={alias} onChangeText={setAlias} />
          <Button title="Enregistrer" onPress={saveAlias} loading={busy} />
        </Card>

        <Card>
          <View
            style={{
              flexDirection: 'row',
              justifyContent: 'space-between',
              alignItems: 'center',
            }}
          >
            <Label>Gestion à distance</Label>
            <Badge label="PRO" tone="gold" />
          </View>
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
                  ? `Tunnel actif — IP ${remoteQuery.data.wgIp}, joignable via ${remoteQuery.data.endpoint}.`
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

        <Button
          title="+ Créer des tickets"
          onPress={() =>
            router.push({
              pathname: '/generate-vouchers',
              params: { routerId: id },
            })
          }
        />

        <Button
          title="Supprimer le routeur"
          variant="danger"
          onPress={remove}
          loading={busy}
        />
      </ScrollView>
      <BottomNav active="routeurs" />
    </View>
  );
}
