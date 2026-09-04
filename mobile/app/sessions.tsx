import { useEffect, useMemo, useRef, useState } from 'react';
import { Animated, ScrollView, Text, TextInput, View } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { api, extractErrorMessage, type LiveSession } from '@/src/lib/api';
import { getLocalCredentials, saveLocalCredentials, parseAddress } from '@/src/lib/router-credentials';
import { reportLanSessions } from '@/src/lib/sessionSync';
import { getWifiInfo, sameSubnet24 } from '@/src/lib/lanBinder';
import {
  listActiveLan,
  terminateActiveLan,
} from '@/src/services/mikrotik-lan/hotspotLan';
import {
  Banner,
  Card,
  Empty,
  FadeIn,
  Mono,
  Press,
  Row,
  space,
  type,
  weight,
  withAlpha,
} from '@/src/components/ui';
import { useTheme } from '@/src/providers/theme-provider';
import { BottomNav, useBottomNavHeight } from '@/src/components/BottomNav';
import { AppHeader } from '@/src/components/AppHeader';

function PulseDot({ color }: { color: string }) {
  const theme = useTheme();
  const scale = useRef(new Animated.Value(1)).current;
  const opacity = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.parallel([
          Animated.timing(scale, { toValue: 1.6, duration: 900, useNativeDriver: true }),
          Animated.timing(opacity, { toValue: 0, duration: 900, useNativeDriver: true }),
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
    <View style={{ position: 'absolute', right: -1, bottom: -1, width: 12, height: 12, alignItems: 'center', justifyContent: 'center' }}>
      <Animated.View style={{ position: 'absolute', width: 12, height: 12, borderRadius: 6, backgroundColor: color, opacity, transform: [{ scale }] }} />
      <View style={{ width: 12, height: 12, borderRadius: 6, backgroundColor: color, borderWidth: 2, borderColor: theme.surface }} />
    </View>
  );
}

const POLL_MS = 15_000;

type SortKey = 'name' | 'data' | 'uptime';

async function lanCredentials(routerId: string) {
  const creds = await getLocalCredentials(routerId);
  if (!creds) return null;
  const wifi = await getWifiInfo();
  const onRouterLan = !!wifi && (creds.host === wifi.gateway || sameSubnet24(creds.host, wifi.ipAddress));
  return onRouterLan ? creds : null;
}

function parseBytes(v: string): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function fmtBytes(v: string): string {
  const n = parseBytes(v);
  if (n < 1024) return `${n} o`;
  if (n < 1024 ** 2) return `${(n / 1024).toFixed(1)} Ko`;
  if (n < 1024 ** 3) return `${(n / 1024 ** 2).toFixed(1)} Mo`;
  return `${(n / 1024 ** 3).toFixed(2)} Go`;
}

function parseUptime(uptime: string | null): number {
  if (!uptime) return 0;
  let total = 0;
  const d = uptime.match(/(\d+)d/);
  const h = uptime.match(/(\d+)h/);
  const m = uptime.match(/(\d+)m/);
  const s = uptime.match(/(\d+)s/);
  if (d) total += parseInt(d[1]) * 86400;
  if (h) total += parseInt(h[1]) * 3600;
  if (m) total += parseInt(m[1]) * 60;
  if (s) total += parseInt(s[1]);
  return total;
}

function DataBar({ value, max, color }: { value: number; max: number; color: string }) {
  const theme = useTheme();
  const pct = max > 0 ? Math.min((value / max) * 100, 100) : 0;
  return (
    <View style={{ height: 4, borderRadius: 2, backgroundColor: withAlpha(color, 0.15), flex: 1 }}>
      <View style={{ height: 4, borderRadius: 2, backgroundColor: color, width: `${pct}%` }} />
    </View>
  );
}

export default function SessionsScreen() {
  const theme = useTheme();
  const { t } = useTranslation();
  const navHeight = useBottomNavHeight();
  const { routerId } = useLocalSearchParams<{ routerId: string }>();
  const qc = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [sortBy, setSortBy] = useState<SortKey>('data');

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

  const localCredsPresentQuery = useQuery({
    queryKey: ['router-local-creds', routerId],
    queryFn: () => getLocalCredentials(routerId),
    enabled: Boolean(routerId),
  });

  useEffect(() => {
    if (!routerId || localCredsPresentQuery.data) return;
    if (!localCredsPresentQuery.isSuccess) return;
    (async () => {
      try {
        const remote = await api.routers.getCredentials(routerId);
        if (remote?.username && remote?.host) {
          const { host, port } = parseAddress(remote.host);
          await saveLocalCredentials(routerId, { username: remote.username, password: remote.password, host, port });
          qc.invalidateQueries({ queryKey: ['router-local-creds', routerId] });
        }
      } catch {}
    })();
  }, [routerId, localCredsPresentQuery.isSuccess, localCredsPresentQuery.data, qc]);

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

  const stats = useMemo(() => {
    let totalIn = 0, totalOut = 0, totalUptime = 0;
    for (const s of sessions) {
      totalIn += parseBytes(s.bytesIn);
      totalOut += parseBytes(s.bytesOut);
      totalUptime += parseUptime(s.uptime);
    }
    const avgUptime = sessions.length > 0 ? Math.round(totalUptime / sessions.length) : 0;
    const avgH = Math.floor(avgUptime / 3600);
    const avgM = Math.floor((avgUptime % 3600) / 60);
    return {
      count: sessions.length,
      totalIn,
      totalOut,
      totalTraffic: totalIn + totalOut,
      avgUptimeLabel: avgH > 0 ? `${avgH}h${avgM.toString().padStart(2, '0')}` : `${avgM}min`,
    };
  }, [sessions]);

  const maxTraffic = useMemo(() => {
    let max = 0;
    for (const s of sessions) {
      const total = parseBytes(s.bytesIn) + parseBytes(s.bytesOut);
      if (total > max) max = total;
    }
    return max;
  }, [sessions]);

  const q = search.trim().toLowerCase();
  const filtered = useMemo(() => {
    let list = q
      ? sessions.filter(
          (s) =>
            (s.user ?? '').toLowerCase().includes(q) ||
            (s.macAddress ?? '').toLowerCase().includes(q) ||
            (s.ipAddress ?? '').toLowerCase().includes(q),
        )
      : [...sessions];

    list.sort((a, b) => {
      if (sortBy === 'data') {
        return (parseBytes(b.bytesIn) + parseBytes(b.bytesOut)) - (parseBytes(a.bytesIn) + parseBytes(a.bytesOut));
      }
      if (sortBy === 'uptime') return parseUptime(b.uptime) - parseUptime(a.uptime);
      return (a.user ?? '').localeCompare(b.user ?? '');
    });
    return list;
  }, [sessions, q, sortBy]);

  const unreliableEmpty = !filtered.length && localCredsPresentQuery.isSuccess && !localCredsPresentQuery.data;

  const SORT_OPTIONS: { key: SortKey; icon: keyof typeof Ionicons.glyphMap; label: string }[] = [
    { key: 'data', icon: 'swap-vertical', label: t('sessions.sortData') },
    { key: 'uptime', icon: 'time-outline', label: t('sessions.sortUptime') },
    { key: 'name', icon: 'person-outline', label: t('sessions.sortName') },
  ];

  return (
    <View style={{ flex: 1, backgroundColor: theme.bg }}>
      <AppHeader title={t('sessions.title')} back />
      <ScrollView
        contentContainerStyle={{ gap: space.md, padding: space.lg, paddingBottom: navHeight }}
      >
        {/* KPI Summary */}
        <FadeIn>
          <Row style={{ gap: space.sm }}>
            <Card style={{ flex: 1, alignItems: 'center', gap: 4, paddingVertical: space.md }}>
              <View style={{ width: 32, height: 32, borderRadius: 10, backgroundColor: withAlpha(theme.success, 0.12), alignItems: 'center', justifyContent: 'center' }}>
                <Ionicons name="people" size={16} color={theme.success} />
              </View>
              <Text style={{ color: theme.text, fontSize: type.h2, fontWeight: weight.heavy }}>{stats.count}</Text>
              <Text style={{ color: theme.textMuted, fontSize: 10, textAlign: 'center' }}>{t('sessions.activeLabel')}</Text>
            </Card>
            <Card style={{ flex: 1, alignItems: 'center', gap: 4, paddingVertical: space.md }}>
              <View style={{ width: 32, height: 32, borderRadius: 10, backgroundColor: withAlpha(theme.primary, 0.12), alignItems: 'center', justifyContent: 'center' }}>
                <Ionicons name="swap-vertical" size={16} color={theme.primary} />
              </View>
              <Mono style={{ color: theme.text, fontSize: type.bodyLg, fontWeight: weight.heavy }}>{fmtBytes(String(stats.totalTraffic))}</Mono>
              <Text style={{ color: theme.textMuted, fontSize: 10, textAlign: 'center' }}>{t('sessions.totalTraffic')}</Text>
            </Card>
            <Card style={{ flex: 1, alignItems: 'center', gap: 4, paddingVertical: space.md }}>
              <View style={{ width: 32, height: 32, borderRadius: 10, backgroundColor: withAlpha(theme.warning, 0.12), alignItems: 'center', justifyContent: 'center' }}>
                <Ionicons name="time" size={16} color={theme.warning} />
              </View>
              <Text style={{ color: theme.text, fontSize: type.bodyLg, fontWeight: weight.heavy }}>{stats.avgUptimeLabel}</Text>
              <Text style={{ color: theme.textMuted, fontSize: 10, textAlign: 'center' }}>{t('sessions.avgUptime')}</Text>
            </Card>
          </Row>
        </FadeIn>

        {/* Traffic summary bar */}
        {stats.count > 0 ? (
          <FadeIn delay={50}>
            <Card style={{ gap: 8 }}>
              <Row>
                <Row style={{ gap: 6, justifyContent: 'flex-start' }}>
                  <Ionicons name="arrow-down" size={14} color={theme.success} />
                  <Mono style={{ color: theme.success, fontSize: 12, fontWeight: weight.bold }}>{fmtBytes(String(stats.totalIn))}</Mono>
                </Row>
                <Row style={{ gap: 6, justifyContent: 'flex-end' }}>
                  <Ionicons name="arrow-up" size={14} color={theme.primary} />
                  <Mono style={{ color: theme.primary, fontSize: 12, fontWeight: weight.bold }}>{fmtBytes(String(stats.totalOut))}</Mono>
                </Row>
              </Row>
              <Row style={{ gap: 4 }}>
                <View style={{ height: 6, borderRadius: 3, backgroundColor: theme.success, flex: stats.totalIn || 1 }} />
                <View style={{ height: 6, borderRadius: 3, backgroundColor: theme.primary, flex: stats.totalOut || 1 }} />
              </Row>
              <Row>
                <Text style={{ color: theme.textMuted, fontSize: 10 }}>{t('sessions.download')}</Text>
                <Text style={{ color: theme.textMuted, fontSize: 10 }}>{t('sessions.upload')}</Text>
              </Row>
            </Card>
          </FadeIn>
        ) : null}

        {/* Search + Sort */}
        <FadeIn delay={80}>
          <View style={{ gap: space.sm }}>
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
                placeholder={t('sessions.searchPlaceholder')}
                placeholderTextColor={theme.textMuted}
                style={{ flex: 1, color: theme.text, paddingVertical: 11, fontSize: 12 }}
              />
              {search ? (
                <Press onPress={() => setSearch('')} accessibilityLabel={t('common.close')}>
                  <Ionicons name="close-circle" size={16} color={theme.textMuted} />
                </Press>
              ) : null}
            </View>
            <Row style={{ gap: 6 }}>
              {SORT_OPTIONS.map((opt) => {
                const active = sortBy === opt.key;
                return (
                  <Press
                    key={opt.key}
                    onPress={() => setSortBy(opt.key)}
                    style={{
                      flexDirection: 'row',
                      alignItems: 'center',
                      gap: 4,
                      paddingVertical: 6,
                      paddingHorizontal: 10,
                      borderRadius: 8,
                      backgroundColor: active ? theme.primary : theme.surface,
                      borderWidth: 1,
                      borderColor: active ? theme.primary : theme.border,
                    }}
                  >
                    <Ionicons name={opt.icon} size={12} color={active ? theme.primaryText : theme.textMuted} />
                    <Text style={{ color: active ? theme.primaryText : theme.textMuted, fontSize: 11, fontWeight: '600' }}>{opt.label}</Text>
                  </Press>
                );
              })}
              <View style={{ flex: 1 }} />
              <Press
                accessibilityLabel={t('common.refresh')}
                onPress={() => qc.invalidateQueries({ queryKey: ['sessions', routerId] })}
                style={{
                  width: 34,
                  height: 34,
                  borderRadius: 10,
                  borderWidth: 1,
                  borderColor: theme.border,
                  backgroundColor: theme.surface,
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                <Ionicons name="refresh" size={16} color={theme.text} />
              </Press>
            </Row>
          </View>
        </FadeIn>

        {error ? <Banner tone="danger">{error}</Banner> : null}
        {query.isError ? <Banner tone="warning">{extractErrorMessage(query.error)}</Banner> : null}
        {unreliableEmpty ? <Banner tone="warning">{t('sessions.unreliableWarning')}</Banner> : null}

        {query.isLoading ? (
          <Text style={{ color: theme.textMuted, fontSize: type.body, textAlign: 'center', paddingVertical: space.xl }}>{t('sessions.readingRouter')}</Text>
        ) : !filtered.length ? (
          <Empty icon="people-outline" text={t('sessions.noSession')} />
        ) : (
          <View style={{ gap: 10 }}>
            {filtered.map((s: LiveSession, idx) => {
              const totalBytes = parseBytes(s.bytesIn) + parseBytes(s.bytesOut);
              return (
                <FadeIn key={s.id} delay={idx * 30}>
                  <View
                    style={{
                      backgroundColor: theme.surface,
                      borderRadius: 14,
                      borderWidth: 1,
                      borderColor: theme.border,
                      padding: 14,
                      gap: 10,
                    }}
                  >
                    {/* Header: avatar + name + disconnect */}
                    <Row>
                      <Row style={{ gap: 10, flex: 1, justifyContent: 'flex-start' }}>
                        <View>
                          <View
                            style={{
                              width: 36,
                              height: 36,
                              borderRadius: 18,
                              backgroundColor: withAlpha(theme.success, 0.13),
                              borderWidth: 1,
                              borderColor: withAlpha(theme.success, 0.33),
                              alignItems: 'center',
                              justifyContent: 'center',
                            }}
                          >
                            <Text style={{ color: theme.success, fontWeight: '700', fontSize: 12 }}>
                              {(s.user ?? '??').substring(0, 2).toUpperCase()}
                            </Text>
                          </View>
                          <PulseDot color={theme.success} />
                        </View>
                        <View style={{ flex: 1 }}>
                          <Text style={{ color: theme.text, fontWeight: '700', fontSize: 13 }} numberOfLines={1}>
                            {s.user || '—'}
                          </Text>
                          <Mono style={{ color: theme.textMuted, fontSize: 10 }}>
                            {s.ipAddress ?? '—'}
                          </Mono>
                        </View>
                      </Row>
                      <Row style={{ gap: 8 }}>
                        {s.uptime ? (
                          <View style={{ backgroundColor: withAlpha(theme.warning, 0.1), borderRadius: 6, paddingHorizontal: 6, paddingVertical: 2 }}>
                            <Mono style={{ color: theme.warning, fontSize: 10, fontWeight: '700' }}>{s.uptime}</Mono>
                          </View>
                        ) : null}
                        <Press
                          accessibilityLabel={t('sessions.disconnect')}
                          onPress={() => terminate(s.id)}
                          hitSlop={3}
                          style={{
                            width: 32,
                            height: 32,
                            borderRadius: 10,
                            backgroundColor: withAlpha(theme.danger, 0.09),
                            borderWidth: 1,
                            borderColor: withAlpha(theme.danger, 0.2),
                            alignItems: 'center',
                            justifyContent: 'center',
                          }}
                        >
                          <Ionicons name="power" size={15} color={theme.danger} />
                        </Press>
                      </Row>
                    </Row>

                    {/* Data usage with progress bar */}
                    <View style={{ gap: 6 }}>
                      <Row>
                        <Row style={{ gap: 4, justifyContent: 'flex-start' }}>
                          <Ionicons name="arrow-down" size={12} color={theme.success} />
                          <Mono style={{ color: theme.text, fontSize: 11, fontWeight: '600' }}>{fmtBytes(s.bytesIn)}</Mono>
                        </Row>
                        <Mono style={{ color: theme.textMuted, fontSize: 10 }}>{fmtBytes(String(totalBytes))}</Mono>
                        <Row style={{ gap: 4, justifyContent: 'flex-end' }}>
                          <Ionicons name="arrow-up" size={12} color={theme.primary} />
                          <Mono style={{ color: theme.text, fontSize: 11, fontWeight: '600' }}>{fmtBytes(s.bytesOut)}</Mono>
                        </Row>
                      </Row>
                      <DataBar value={totalBytes} max={maxTraffic} color={theme.primary} />
                    </View>

                    {/* MAC address footer */}
                    {s.macAddress ? (
                      <Mono style={{ color: theme.textMuted, fontSize: 9, letterSpacing: 0.5 }}>
                        {s.macAddress}
                      </Mono>
                    ) : null}
                  </View>
                </FadeIn>
              );
            })}
          </View>
        )}
      </ScrollView>
      <BottomNav active="index" />
    </View>
  );
}
