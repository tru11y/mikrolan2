import { useCallback, useEffect, useState } from 'react';
import { ScrollView, Text, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
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
import {
  Badge,
  Banner,
  Button,
  Card,
  Field,
  Label,
  Screen,
  Subtitle,
  theme,
  Title,
} from '@/src/components/ui';

function Row({ label, value }: { label: string; value: string }) {
  return (
    <View
      style={{
        flexDirection: 'row',
        justifyContent: 'space-between',
        paddingVertical: 4,
      }}
    >
      <Label>{label}</Label>
      <Text style={{ color: theme.text, fontFamily: theme.mono, fontSize: 12.5 }}>
        {value}
      </Text>
    </View>
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

  const [remoteBusy, setRemoteBusy] = useState(false);
  const [remoteMsg, setRemoteMsg] = useState<
    { tone: 'success' | 'danger'; text: string } | null
  >(null);

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

    // 1) LAN first: works offline on the router's Wi-Fi (free/local mode).
    const creds = await getLocalCredentials(id);
    if (creds) {
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
    <Screen>
      <ScrollView contentContainerStyle={{ gap: 16 }}>
        <View style={{ gap: 6 }}>
          <Title>{r.alias || r.identity}</Title>
          <View style={{ flexDirection: 'row', gap: 8 }}>
            <Badge label={r.identity} />
            <Badge
              label={r.mode === 'REMOTE' ? 'À distance' : 'Local'}
              tone={r.mode === 'REMOTE' ? 'gold' : 'muted'}
            />
          </View>
        </View>

        {error ? <Banner tone="danger">{error}</Banner> : null}

        <Card>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
            <Label>État du routeur</Label>
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
            <View>
              <Row label="Identité" value={r.identity} />
              <Row label="Version" value={resource.version} />
              <Row label="Modèle" value={resource['board-name']} />
              <Row label="Uptime" value={resource.uptime} />
              <Row label="CPU" value={`${resource['cpu-load']}%`} />
              <Row
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
          <Field label="Alias" value={alias} onChangeText={setAlias} />
          <Button title="Enregistrer" onPress={saveAlias} loading={busy} />
        </Card>

        <Card>
          <Label>Gestion à distance</Label>
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
            </>
          )}
        </Card>

        <Button
          title="Supprimer le routeur"
          variant="danger"
          onPress={remove}
          loading={busy}
        />
      </ScrollView>
    </Screen>
  );
}
