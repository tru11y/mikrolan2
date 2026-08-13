import { useEffect, useRef, useState } from 'react';
import { Animated, ScrollView, Text, TextInput, View } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, extractErrorMessage, type LiveSession } from '@/src/lib/api';
import { getLocalCredentials } from '@/src/lib/router-credentials';
import { reportLanSessions } from '@/src/lib/sessionSync';
import { getWifiInfo, sameSubnet24 } from '@/src/lib/lanBinder';
import {
  listActiveLan,
  terminateActiveLan,
} from '@/src/services/mikrotik-lan/hotspotLan';
import {
  Banner,
  Empty,
  Press,
  Row,
  space,
  Subtitle,
  theme,
  Title,
} from '@/src/components/ui';
import { BottomNav, useBottomNavHeight } from '@/src/components/BottomNav';
import { AppHeader } from '@/src/components/AppHeader';

// Small "device is live" heartbeat — matches the reference's animate-pulse dot.
function PulseDot({ color }: { color: string }) {
  const scale = useRef(new Animated.Value(1)).current;
  const opacity = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.parallel([
          Animated.timing(scale, {
            toValue: 1.6,
            duration: 900,
            useNativeDriver: true,
          }),
          Animated.timing(opacity, {
            toValue: 0,
            duration: 900,
            useNativeDriver: true,
          }),
        ]),
        Animated.parallel([
          Animated.timing(scale, { toValue: 1, duration: 0, useNativeDriver: true }),
          Animated.timing(opacity, { toValue: 1, duration: 0, useNativeDriver: true }),
        ]),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [opacity, scale]);

  return (
    <View
      style={{
        position: 'absolute',
        right: -1,
        bottom: -1,
        width: 12,
        height: 12,
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <Animated.View
        style={{
          position: 'absolute',
          width: 12,
          height: 12,
          borderRadius: 6,
          backgroundColor: color,
          opacity,
          transform: [{ scale }],
        }}
      />
      <View
        style={{
          width: 12,
          height: 12,
          borderRadius: 6,
          backgroundColor: color,
          borderWidth: 2,
          borderColor: theme.surface,
        }}
      />
    </View>
  );
}

const POLL_MS = 15_000;

/**
 * Credentials LAN, mais seulement si le routeur est joignable depuis le Wi-Fi
 * courant. Sans cette garde, l'écran ouvrait le socket LAN dès que des
 * credentials existaient sur le téléphone — donc aussi en 4G ou sur un autre
 * Wi-Fi, où le routeur est injoignable : la liste restait vide alors que le
 * serveur, lui, sait la lire via le tunnel (mode PRO). Même garde que
 * router/[id].tsx, qui protège aussi d'un crash natif du socket épinglé.
 */
async function lanCredentials(routerId: string) {
  const creds = await getLocalCredentials(routerId);
  if (!creds) return null;
  const wifi = await getWifiInfo();
  const onRouterLan =
    !!wifi &&
    (creds.host === wifi.gateway || sameSubnet24(creds.host, wifi.ipAddress));
  return onRouterLan ? creds : null;
}

function fmtBytes(v: string): string {
  const n = Number(v);
  if (!Number.isFinite(n)) return v;
  if (n < 1024) return `${n} o`;
  if (n < 1024 ** 2) return `${(n / 1024).toFixed(1)} Ko`;
  if (n < 1024 ** 3) return `${(n / 1024 ** 2).toFixed(1)} Mo`;
  return `${(n / 1024 ** 3).toFixed(2)} Go`;
}

export default function SessionsScreen() {
  const navHeight = useBottomNavHeight();
  const { routerId } = useLocalSearchParams<{ routerId: string }>();
  const qc = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');

  const query = useQuery({
    queryKey: ['sessions', routerId],
    enabled: Boolean(routerId),
    refetchInterval: POLL_MS,
    placeholderData: keepPreviousData,
    queryFn: async (): Promise<LiveSession[]> => {
      const creds = await lanCredentials(routerId);
      if (creds) {
        const active = await listActiveLan(creds);
        void reportLanSessions(routerId, active);
        return active;
      }
      return api.routers.listSessions(routerId);
    },
  });

  // Sans identifiants locaux (ou hors Wi-Fi du routeur), la lecture bascule
  // sur la DB — qui ne reflète que la dernière synchro LAN. Une liste vide
  // dans ce cas n'est pas fiable : on le dit explicitement plutôt que de
  // laisser croire qu'aucun client n'est connecté.
  const localCredsPresentQuery = useQuery({
    queryKey: ['router-local-creds', routerId],
    queryFn: () => getLocalCredentials(routerId),
    enabled: Boolean(routerId),
  });

  async function terminate(mikrotikId: string) {
    setError(null);
    try {
      const creds = await lanCredentials(routerId);
      if (creds) {
        await terminateActiveLan(creds, mikrotikId);
      } else {
        await api.routers.terminateSession(routerId, mikrotikId);
      }
      await qc.invalidateQueries({ queryKey: ['sessions', routerId] });
    } catch (e) {
      setError(extractErrorMessage(e));
    }
  }

  const sessions = query.data ?? [];
  const q = search.trim().toLowerCase();
  const filtered = q
    ? sessions.filter(
        (s) =>
          (s.user ?? '').toLowerCase().includes(q) ||
          (s.macAddress ?? '').toLowerCase().includes(q) ||
          (s.ipAddress ?? '').toLowerCase().includes(q),
      )
    : sessions;
  const unreliableEmpty =
    !filtered.length &&
    localCredsPresentQuery.isSuccess &&
    !localCredsPresentQuery.data;

  return (
    <View style={{ flex: 1, backgroundColor: theme.bg }}>
      <AppHeader title="Utilisateurs actifs" back />
      <ScrollView
        contentContainerStyle={{ gap: space.lg, padding: space.lg, paddingBottom: navHeight }}
      >
        <Row>
          <View style={{ flex: 1 }}>
            <Subtitle>
              {sessions.length} session{sessions.length > 1 ? 's' : ''} en cours
            </Subtitle>
          </View>
          <Press
            accessibilityLabel="Rafraîchir"
            onPress={() =>
              qc.invalidateQueries({ queryKey: ['sessions', routerId] })
            }
            style={{
              width: 42,
              height: 42,
              borderRadius: 12,
              borderWidth: 1,
              borderColor: theme.border,
              backgroundColor: theme.surface,
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <Ionicons name="refresh" size={20} color={theme.text} />
          </Press>
        </Row>

        {/* Search */}
        <View
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            gap: 8,
            backgroundColor: theme.surface,
            borderWidth: 1,
            borderColor: theme.border,
            borderRadius: 12,
            paddingHorizontal: 12,
          }}
        >
          <Ionicons name="search" size={16} color={theme.textMuted} />
          <TextInput
            value={search}
            onChangeText={setSearch}
            placeholder="Rechercher nom, MAC, IP…"
            placeholderTextColor={theme.textMuted}
            style={{ flex: 1, color: theme.text, paddingVertical: 11, fontSize: 12 }}
          />
        </View>

        {error ? <Banner tone="danger">{error}</Banner> : null}
        {query.isError ? (
          <Banner tone="warning">{extractErrorMessage(query.error)}</Banner>
        ) : null}

        {unreliableEmpty ? (
          <Banner tone="warning">
            Ce routeur n'a pas d'identifiants sur ce téléphone — cette liste
            peut être obsolète. Ajoutez-les dans Paramètres routeur →
            Identifiants du routeur.
          </Banner>
        ) : null}

        {query.isLoading ? (
          <Subtitle>Lecture du routeur…</Subtitle>
        ) : !filtered.length ? (
          <Empty icon="people-outline" text="Aucune session active." />
        ) : (
          <View style={{ gap: 12 }}>
            {filtered.map((s: LiveSession) => (
              <View
                key={s.id}
                style={{
                  backgroundColor: theme.surface,
                  borderRadius: 16,
                  borderWidth: 1,
                  borderColor: theme.border,
                  padding: 16,
                  gap: 12,
                }}
              >
                <Row>
                  <Row style={{ gap: 12, flex: 1, justifyContent: 'flex-start' }}>
                    <View>
                      <View
                        style={{
                          width: 40,
                          height: 40,
                          borderRadius: 20,
                          backgroundColor: theme.success + '22',
                          borderWidth: 1,
                          borderColor: theme.success + '55',
                          alignItems: 'center',
                          justifyContent: 'center',
                        }}
                      >
                        <Text style={{ color: theme.success, fontWeight: '700', fontSize: 13 }}>
                          {(s.user ?? '??').substring(0, 2).toUpperCase()}
                        </Text>
                      </View>
                      <PulseDot color={theme.success} />
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={{ color: theme.text, fontWeight: '700', fontSize: 14 }}>
                        {s.user || '—'}
                      </Text>
                      <Text
                        style={{
                          color: theme.textMuted,
                          fontFamily: theme.mono,
                          fontSize: 11,
                        }}
                      >
                        {s.macAddress ?? 'MAC ?'} · {s.ipAddress ?? '—'}
                      </Text>
                    </View>
                  </Row>
                  <Press
                    accessibilityLabel="Déconnecter"
                    onPress={() => terminate(s.id)}
                    hitSlop={3}
                    style={{
                      width: 38,
                      height: 38,
                      borderRadius: 11,
                      borderWidth: 1,
                      borderColor: theme.border,
                      backgroundColor: theme.danger + '18',
                      alignItems: 'center',
                      justifyContent: 'center',
                    }}
                  >
                    <Ionicons name="power" size={17} color={theme.danger} />
                  </Press>
                </Row>

                {/* Metrics */}
                <Row
                  style={{
                    backgroundColor: theme.surfaceAlt,
                    borderRadius: 12,
                    borderWidth: 1,
                    borderColor: theme.border,
                    padding: 10,
                    gap: 8,
                  }}
                >
                  <Row style={{ gap: 6, flex: 1, justifyContent: 'flex-start' }}>
                    <Ionicons name="time-outline" size={13} color={theme.secondary} />
                    <Text style={{ color: theme.textMuted, fontSize: 12 }}>Temps</Text>
                    <Text
                      style={{
                        color: theme.text,
                        fontFamily: theme.mono,
                        fontSize: 12,
                        fontWeight: '700',
                      }}
                    >
                      {s.uptime ?? '—'}
                    </Text>
                  </Row>
                  <Row style={{ gap: 4, justifyContent: 'flex-end' }}>
                    <Ionicons name="arrow-down" size={13} color={theme.secondary} />
                    <Ionicons name="arrow-up" size={13} color={theme.gold} />
                    <Text
                      style={{
                        color: theme.text,
                        fontFamily: theme.mono,
                        fontSize: 12,
                        fontWeight: '700',
                      }}
                    >
                      {fmtBytes(s.bytesIn)} / {fmtBytes(s.bytesOut)}
                    </Text>
                  </Row>
                </Row>
              </View>
            ))}
          </View>
        )}
      </ScrollView>
      <BottomNav active="index" />
    </View>
  );
}
