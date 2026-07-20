import { useCallback, useEffect, useState } from 'react';
import { ScrollView, Text, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api, extractErrorMessage } from '@/src/lib/api';
import { useAuth } from '@/src/providers/auth-provider';
import {
  MikroTikLanClient,
  type SystemResource,
} from '@/src/services/mikrotik-lan/MikroTikLanClient';
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
      <Text style={{ color: theme.text }}>{value}</Text>
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

  const [alias, setAlias] = useState('');
  const [resource, setResource] = useState<SystemResource | null>(null);
  const [lanState, setLanState] = useState<
    'idle' | 'loading' | 'ok' | 'no-creds' | 'error'
  >('idle');
  const [lanError, setLanError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (query.data) setAlias(query.data.alias ?? '');
  }, [query.data]);

  const loadLocal = useCallback(async () => {
    if (!id) return;
    setLanState('loading');
    setLanError(null);
    const creds = await getLocalCredentials(id);
    if (!creds) {
      setLanState('no-creds');
      return;
    }
    try {
      const client = new MikroTikLanClient(creds);
      setResource(await client.systemResource());
      setLanState('ok');
    } catch (e) {
      setLanError(extractErrorMessage(e));
      setLanState('error');
    }
  }, [id]);

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
              tone={r.mode === 'REMOTE' ? 'primary' : 'muted'}
            />
          </View>
        </View>

        {error ? <Banner tone="danger">{error}</Banner> : null}

        <Card>
          <Label>État local (LAN)</Label>
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
            title="Rafraîchir l'état local"
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
          <Subtitle>
            {isPro
              ? 'Votre plan PRO permet le pilotage à distance via tunnel sécurisé.'
              : 'Réservé au plan PRO. Le pilotage hors du réseau local nécessite un abonnement.'}
          </Subtitle>
          <Button
            title={isPro ? 'Activer le tunnel à distance' : 'Passer à PRO'}
            variant="ghost"
            disabled
            onPress={() => {
              /* Phase 4 (WG provisioning) / Phase 3 (abonnement) */
            }}
          />
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
