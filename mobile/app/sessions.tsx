import { useState } from 'react';
import { ScrollView, Text, View } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api, extractErrorMessage, type LiveSession } from '@/src/lib/api';
import { getLocalCredentials } from '@/src/lib/router-credentials';
import {
  listActiveLan,
  terminateActiveLan,
} from '@/src/services/mikrotik-lan/hotspotLan';
import {
  Badge,
  Banner,
  Button,
  Card,
  Empty,
  Label,
  Screen,
  Subtitle,
  Title,
  theme,
} from '@/src/components/ui';

function fmtBytes(v: string): string {
  const n = Number(v);
  if (!Number.isFinite(n)) return v;
  if (n < 1024) return `${n} o`;
  if (n < 1024 ** 2) return `${(n / 1024).toFixed(1)} Ko`;
  if (n < 1024 ** 3) return `${(n / 1024 ** 2).toFixed(1)} Mo`;
  return `${(n / 1024 ** 3).toFixed(2)} Go`;
}

export default function SessionsScreen() {
  const { routerId } = useLocalSearchParams<{ routerId: string }>();
  const qc = useQueryClient();
  const [error, setError] = useState<string | null>(null);

  const routerQuery = useQuery({
    queryKey: ['router', routerId],
    queryFn: () => api.routers.get(routerId),
    enabled: Boolean(routerId),
  });
  const isRemote = routerQuery.data?.mode === 'REMOTE';

  // REMOTE → read over the tunnel (backend). LOCAL → read over the LAN directly.
  const query = useQuery({
    queryKey: ['sessions', routerId, isRemote],
    enabled: Boolean(routerId) && routerQuery.isSuccess,
    queryFn: async (): Promise<LiveSession[]> => {
      if (isRemote) return api.routers.listSessions(routerId);
      const creds = await getLocalCredentials(routerId);
      if (!creds) {
        throw new Error(
          'Identifiants locaux requis : testez d’abord la connexion LAN.',
        );
      }
      return listActiveLan(creds);
    },
  });

  async function terminate(mikrotikId: string) {
    setError(null);
    try {
      if (isRemote) {
        await api.routers.terminateSession(routerId, mikrotikId);
      } else {
        const creds = await getLocalCredentials(routerId);
        if (!creds) throw new Error('Identifiants locaux requis.');
        await terminateActiveLan(creds, mikrotikId);
      }
      await qc.invalidateQueries({ queryKey: ['sessions', routerId] });
    } catch (e) {
      setError(extractErrorMessage(e));
    }
  }

  return (
    <Screen>
      <ScrollView contentContainerStyle={{ gap: 16 }}>
        <Title>Sessions actives</Title>
        <Subtitle>Tous les clients connectés au hotspot en ce moment.</Subtitle>

        {error ? <Banner tone="danger">{error}</Banner> : null}
        {query.isError ? (
          <Banner tone="warning">{extractErrorMessage(query.error)}</Banner>
        ) : null}

        <Button
          title="Rafraîchir"
          variant="ghost"
          onPress={() => qc.invalidateQueries({ queryKey: ['sessions', routerId] })}
          loading={query.isFetching}
        />

        {query.isLoading ? (
          <Subtitle>Lecture du routeur…</Subtitle>
        ) : !query.data?.length ? (
          <Empty text="Aucune session active." />
        ) : (
          query.data.map((s: LiveSession) => (
            <Card key={s.id}>
              <View
                style={{
                  flexDirection: 'row',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                }}
              >
                <Text
                  style={{
                    color: theme.text,
                    fontFamily: theme.mono,
                    fontWeight: '700',
                  }}
                >
                  {s.user || '—'}
                </Text>
                <Badge label="Actif" tone="success" />
              </View>
              <Label>
                {s.ipAddress ?? '—'} · {s.macAddress ?? 'MAC inconnue'}
              </Label>
              <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>
                <Badge label={`↓ ${fmtBytes(s.bytesIn)}`} tone="primary" />
                <Badge label={`↑ ${fmtBytes(s.bytesOut)}`} tone="primary" />
                {s.uptime ? <Badge label={s.uptime} /> : null}
              </View>
              <Button
                title="Déconnecter"
                variant="danger"
                onPress={() => terminate(s.id)}
              />
            </Card>
          ))
        )}
      </ScrollView>
    </Screen>
  );
}
