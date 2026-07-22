import { useCallback } from 'react';
import { FlatList, Pressable, RefreshControl, Text, View } from 'react-native';
import { Link, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';
import { api, extractErrorMessage, type RouterItem } from '@/src/lib/api';
import {
  Badge,
  Banner,
  Button,
  Card,
  Empty,
  Mono,
  Row,
  Screen,
  Subtitle,
  theme,
  Title,
} from '@/src/components/ui';

function healthTone(h: RouterItem['health']) {
  return h === 'ONLINE'
    ? 'secondary'
    : h === 'ERROR'
      ? 'danger'
      : h === 'OFFLINE'
        ? 'warning'
        : 'muted';
}

export default function RouteursScreen() {
  const router = useRouter();
  const query = useQuery({
    queryKey: ['routers'],
    queryFn: api.routers.list,
  });

  const renderItem = useCallback(
    ({ item }: { item: RouterItem }) => (
      <Link href={`/router/${item.id}`} asChild>
        <Pressable>
          <Card style={{ marginBottom: 12 }}>
            <Row style={{ gap: 12 }}>
              <View
                style={{
                  width: 40,
                  height: 40,
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
              <View style={{ flex: 1 }}>
                <Text style={{ color: theme.text, fontSize: 16, fontWeight: '700' }}>
                  {item.alias || item.identity}
                </Text>
                <Mono style={{ color: theme.textMuted, fontSize: 12 }}>
                  {item.identity}
                  {item.localAddress ? ` · ${item.localAddress}` : ''}
                </Mono>
              </View>
              <Badge
                label={
                  item.health === 'ONLINE'
                    ? 'EN LIGNE'
                    : item.health === 'OFFLINE'
                      ? 'HORS LIGNE'
                      : item.health
                }
                tone={healthTone(item.health)}
              />
            </Row>
            <Row style={{ justifyContent: 'flex-start' }}>
              <Badge
                label={item.mode === 'REMOTE' ? 'À DISTANCE' : 'LOCAL'}
                tone={item.mode === 'REMOTE' ? 'gold' : 'secondary'}
              />
            </Row>
          </Card>
        </Pressable>
      </Link>
    ),
    [],
  );

  return (
    <Screen>
      <View
        style={{
          flexDirection: 'row',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: 16,
        }}
      >
        <View>
          <Title>Mes routeurs</Title>
          <Subtitle>{query.data?.length ?? 0} routeur(s)</Subtitle>
        </View>
        <View style={{ width: 130 }}>
          <Button title="Ajouter" onPress={() => router.push('/add-router')} />
        </View>
      </View>

      {query.isError ? (
        <Banner tone="danger">{extractErrorMessage(query.error)}</Banner>
      ) : null}

      <FlatList
        data={query.data ?? []}
        keyExtractor={(r) => r.id}
        renderItem={renderItem}
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
    </Screen>
  );
}
