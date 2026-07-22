import { useCallback } from 'react';
import { FlatList, Pressable, RefreshControl, View } from 'react-native';
import { Link, useRouter } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { api, extractErrorMessage, type RouterItem } from '@/src/lib/api';
import {
  Badge,
  Banner,
  Button,
  Card,
  Empty,
  Screen,
  Subtitle,
  theme,
  Title,
} from '@/src/components/ui';
import { Text } from 'react-native';

function healthTone(h: RouterItem['health']) {
  return h === 'ONLINE'
    ? 'success'
    : h === 'ERROR'
      ? 'danger'
      : h === 'OFFLINE'
        ? 'warning'
        : 'muted';
}

export default function RoutersScreen() {
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
            <View
              style={{
                flexDirection: 'row',
                justifyContent: 'space-between',
                alignItems: 'center',
              }}
            >
              <Text style={{ color: theme.text, fontSize: 16, fontWeight: '700' }}>
                {item.alias || item.identity}
              </Text>
              <Badge label={item.health} tone={healthTone(item.health)} />
            </View>
            <Text
              style={{
                color: theme.textMuted,
                fontSize: 12,
                fontFamily: theme.mono,
              }}
            >
              {item.identity}
              {item.localAddress ? ` · ${item.localAddress}` : ''}
            </Text>
            <Badge
              label={item.mode === 'REMOTE' ? 'À distance' : 'Local'}
              tone={item.mode === 'REMOTE' ? 'gold' : 'muted'}
            />
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
