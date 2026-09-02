import { useCallback } from 'react';
import { FlatList, RefreshControl, Text, View } from 'react-native';
import { Link, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { api, extractErrorMessage, type RouterItem } from '@/src/lib/api';
import { useAuth } from '@/src/providers/auth-provider';
import {
  Banner,
  Card,
  elevation,
  Empty,
  ErrorState,
  icon,
  IconChip,
  Mono,
  Press,
  routerHealth,
  Row,
  SkeletonCard,
  space,
  theme,
  type,
  weight,
} from '@/src/components/ui';
import { BottomNav, useBottomNavHeight } from '@/src/components/BottomNav';
import { AppHeader } from '@/src/components/AppHeader';
import { RouterStatusDot } from '@/src/components/RouterStatusDot';

export default function RouteursScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const navHeight = useBottomNavHeight();
  const { isPro } = useAuth();
  const query = useQuery({
    queryKey: ['routers'],
    queryFn: api.routers.list,
    refetchInterval: 15_000,
    placeholderData: keepPreviousData,
  });

  const list = query.data ?? [];
  const hasData = list.length > 0;

  const renderItem = useCallback(
    ({ item }: { item: RouterItem }) => {
      const isOffline = item.health !== 'ONLINE';
      const health = routerHealth(item.health);
      const modeLabel = item.mode === 'REMOTE' ? t('routers.remote') : t('routers.local');
      const a11yLabel = `${item.alias || item.identity}, ${health.label}, ${modeLabel}`;
      return (
        <Link href={`/router/${item.id}`} asChild>
          <Press
            accessibilityLabel={a11yLabel}
            accessibilityHint={t('routers.openDashboard')}
            style={{ marginBottom: space.md }}
          >
            <Card style={{ opacity: isOffline ? 0.65 : 1 }}>
              <Row style={{ gap: space.md, alignItems: 'flex-start' }}>
                <IconChip name="hardware-chip-outline" color={theme.primary} size="md" />
                <View style={{ flex: 1, gap: 3 }}>
                  <Text
                    style={{
                      color: theme.text,
                      fontSize: type.bodyLg,
                      fontWeight: weight.bold,
                    }}
                  >
                    {item.alias || item.identity}
                  </Text>
                  <Mono style={{ color: theme.textMuted, fontSize: type.caption }}>
                    {item.identity}
                  </Mono>
                  {item.model ? (
                    <Text style={{ color: theme.textMuted, fontSize: type.caption }}>
                      {item.model}
                    </Text>
                  ) : null}
                </View>
                <RouterStatusDot health={item.health} />
              </Row>
            </Card>
          </Press>
        </Link>
      );
    },
    [isPro],
  );

  return (
    <View style={{ flex: 1, backgroundColor: theme.bg }}>
      <AppHeader title={t('routers.title')} />

      {query.isLoading ? (
        <View style={{ padding: space.lg, paddingBottom: navHeight, gap: space.md }}>
          <SkeletonCard />
          <SkeletonCard />
          <SkeletonCard />
        </View>
      ) : query.isError && !hasData ? (
        <ErrorState
          message={extractErrorMessage(query.error)}
          onRetry={() => query.refetch()}
          retrying={query.isRefetching}
        />
      ) : (
        <FlatList
          contentContainerStyle={{ padding: space.lg, paddingBottom: navHeight }}
          data={list}
          keyExtractor={(r) => r.id}
          renderItem={renderItem}
          ListHeaderComponent={
            query.isError && hasData ? (
              <View style={{ marginBottom: space.lg }}>
                <Banner tone="danger">{extractErrorMessage(query.error)}</Banner>
              </View>
            ) : null
          }
          refreshControl={
            <RefreshControl
              refreshing={query.isRefetching}
              onRefresh={query.refetch}
              tintColor={theme.primary}
            />
          }
          ListEmptyComponent={
            <Empty
              text={t('routers.noRouter')}
              icon="hardware-chip-outline"
              action={{
                label: t('routers.addRouter'),
                onPress: () => router.push('/add-router'),
              }}
            />
          }
        />
      )}

      <Press
        accessibilityLabel={t('routers.addRouter')}
        accessibilityHint={t('routers.openDashboard')}
        onPress={() => router.push('/add-router')}
        style={[
          {
            position: 'absolute',
            right: space.xl,
            bottom: navHeight,
            // 56px : taille standard d'un FAB, aucun token dédié dans le
            // design system pour cette dimension précise.
            width: 56,
            height: 56,
            borderRadius: 28,
            backgroundColor: theme.primary,
            alignItems: 'center',
            justifyContent: 'center',
            // `elevation` (Android) ne pilote que l'ombre, pas la priorité de
            // hit-test tactile entre siblings absolus : sans zIndex explicite,
            // BottomNav (déclaré après, donc prioritaire au toucher malgré son
            // absence de chevauchement visuel) rendait ce FAB totalement
            // inerte — vérifié sur device réel (absent de l'arbre
            // d'accessibilité, aucun tap ne passait).
            zIndex: 10,
          },
          elevation.floating,
        ]}
      >
        <Ionicons name="add" size={icon.xl} color={theme.primaryText} />
      </Press>
      <BottomNav active="routeurs" />
    </View>
  );
}
