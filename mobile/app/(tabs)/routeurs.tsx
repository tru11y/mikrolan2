import { useCallback } from 'react';
import {
  FlatList,
  Pressable,
  RefreshControl,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Link, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';
import { api, extractErrorMessage, type RouterItem } from '@/src/lib/api';
import {
  Badge,
  Banner,
  Card,
  Empty,
  Mono,
  Row,
  theme,
  Title,
} from '@/src/components/ui';
import { BottomNav } from '@/src/components/BottomNav';

function healthTone(h: RouterItem['health']) {
  return h === 'ONLINE'
    ? 'secondary'
    : h === 'ERROR'
      ? 'danger'
      : h === 'OFFLINE'
        ? 'warning'
        : 'muted';
}

function Dot({ color }: { color: string }) {
  return (
    <View
      style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: color }}
    />
  );
}

export default function RouteursScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const query = useQuery({ queryKey: ['routers'], queryFn: api.routers.list });

  const list = query.data ?? [];
  const online = list.filter((r) => r.health === 'ONLINE').length;
  const offline = list.length - online;

  const renderItem = useCallback(
    ({ item }: { item: RouterItem }) => {
      const isOffline = item.health !== 'ONLINE';
      return (
        <Link href={`/router/${item.id}`} asChild>
          <Pressable>
            <Card style={{ marginBottom: 12, opacity: isOffline ? 0.65 : 1 }}>
              <Row style={{ gap: 12, alignItems: 'flex-start' }}>
                <View
                  style={{
                    width: 42,
                    height: 42,
                    borderRadius: 12,
                    backgroundColor: theme.primary + '22',
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  <Ionicons
                    name="hardware-chip-outline"
                    size={20}
                    color={theme.primary}
                  />
                </View>
                <View style={{ flex: 1, gap: 3 }}>
                  <Text
                    style={{ color: theme.text, fontSize: 16, fontWeight: '700' }}
                  >
                    {item.alias || item.identity}
                  </Text>
                  <Mono style={{ color: theme.textMuted, fontSize: 12 }}>
                    {item.identity}
                    {item.localAddress ? ` · ${item.localAddress}` : ''}
                  </Mono>
                  {item.model ? (
                    <Text style={{ color: theme.textMuted, fontSize: 12 }}>
                      {item.model}
                    </Text>
                  ) : null}
                </View>
                <View style={{ alignItems: 'flex-end', gap: 6 }}>
                  <Badge
                    label={item.health === 'ONLINE' ? 'EN LIGNE' : 'HORS LIGNE'}
                    tone={healthTone(item.health)}
                  />
                  <Badge
                    label={item.mode === 'REMOTE' ? 'À DISTANCE' : 'LOCAL'}
                    tone={item.mode === 'REMOTE' ? 'gold' : 'secondary'}
                  />
                </View>
              </Row>
            </Card>
          </Pressable>
        </Link>
      );
    },
    [],
  );

  return (
    <View style={{ flex: 1, backgroundColor: theme.bg }}>
      <FlatList
        contentContainerStyle={{ padding: 16, paddingBottom: 100 }}
        data={list}
        keyExtractor={(r) => r.id}
        renderItem={renderItem}
        ListHeaderComponent={
          <View style={{ marginBottom: 16, gap: 8 }}>
            <Title>Mes routeurs</Title>
            <Row style={{ justifyContent: 'flex-start', gap: 16 }}>
              <Row style={{ gap: 6, justifyContent: 'flex-start' }}>
                <Dot color={theme.secondary} />
                <Text style={{ color: theme.textMuted, fontSize: 13 }}>
                  {online} en ligne
                </Text>
              </Row>
              <Row style={{ gap: 6, justifyContent: 'flex-start' }}>
                <Dot color={theme.danger} />
                <Text style={{ color: theme.textMuted, fontSize: 13 }}>
                  {offline} hors ligne
                </Text>
              </Row>
            </Row>
            {query.isError ? (
              <Banner tone="danger">{extractErrorMessage(query.error)}</Banner>
            ) : null}
          </View>
        }
        refreshControl={
          <RefreshControl
            refreshing={query.isRefetching}
            onRefresh={query.refetch}
            tintColor={theme.primary}
          />
        }
        ListEmptyComponent={
          query.isLoading ? null : (
            <Empty text="Aucun routeur. Ajoutez-en un pour commencer — gratuit en local." />
          )
        }
      />

      <Pressable
        accessibilityLabel="Ajouter un routeur"
        onPress={() => router.push('/add-router')}
        style={{
          position: 'absolute',
          right: 20,
          bottom: 76 + insets.bottom,
          width: 56,
          height: 56,
          borderRadius: 28,
          backgroundColor: theme.primary,
          alignItems: 'center',
          justifyContent: 'center',
          shadowColor: theme.primary,
          shadowOpacity: 0.5,
          shadowRadius: 12,
          shadowOffset: { width: 0, height: 4 },
          elevation: 6,
        }}
      >
        <Ionicons name="add" size={28} color={theme.primaryText} />
      </Pressable>
      <BottomNav active="routeurs" />
    </View>
  );
}
