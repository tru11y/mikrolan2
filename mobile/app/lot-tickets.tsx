export { ScreenErrorBoundary as ErrorBoundary } from '@/src/components/ScreenErrorBoundary';
import { useEffect, useMemo, useState } from 'react';
import { FlatList, Share, Text, View } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { useInfiniteQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { api, extractErrorMessage, type VoucherSearchItem } from '@/src/lib/api';
import { printTickets, printTicketsDirect } from '@/src/lib/ticketsPdf';
import { mergePages, normalizeSearch, ticketShareText, TICKET_STATUS_LABEL, TICKET_STATUS_TONE } from '@/src/lib/ticketSearch';
import { reportSilent } from '@/src/lib/report';
import { Badge, Banner, Button, Card, Empty, ErrorState, Field, Row, Skeleton, space, Title } from '@/src/components/ui';
import { useTheme } from '@/src/providers/theme-provider';
import { AppHeader } from '@/src/components/AppHeader';
import { BottomNav, useBottomNavHeight } from '@/src/components/BottomNav';

const PAGE = 30;
type Action = 'share' | 'print' | 'download';

/** Tickets d'un lot : liste paginée, recherche par code, actions par ticket (propriétaire / admin). */
export default function LotTicketsScreen() {
  const theme = useTheme();
  const { t } = useTranslation();
  const navHeight = useBottomNavHeight();
  const { routerId, batchId, batchSeq } = useLocalSearchParams<{ routerId: string; batchId?: string; batchSeq?: string }>();
  const [search, setSearch] = useState('');
  const [debounced, setDebounced] = useState<string | undefined>(undefined);
  const [busy, setBusy] = useState<{ id: string; kind: Action } | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const h = setTimeout(() => setDebounced(normalizeSearch(search)), 350);
    return () => clearTimeout(h);
  }, [search]);

  const query = useInfiniteQuery({
    queryKey: ['voucher-search', routerId, batchId ?? null, debounced ?? null],
    enabled: Boolean(routerId),
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) =>
      api.routers.searchVouchers(routerId, { q: debounced, batchId, limit: PAGE, cursor: pageParam }),
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });
  const items = useMemo(() => mergePages(query.data?.pages ?? []), [query.data]);

  async function act(v: VoucherSearchItem, kind: Action) {
    setError(null);
    setBusy({ id: v.id, kind });
    try {
      // Le serveur journalise chaque réimpression et refuse (409) un ticket annulé, ou utilisé hors propriétaire.
      const r = await api.routers.reprintVoucher(routerId, v.id);
      if (kind === 'share') {
        await Share.share({ message: ticketShareText({ code: r.code, planName: r.plan.name, durationMinutes: r.plan.durationMinutes, priceXof: r.plan.priceXof }) });
        return;
      }
      const opts = {
        routerName: '',
        planName: r.plan.name,
        durationMinutes: r.plan.durationMinutes,
        priceXof: r.plan.priceXof,
        tickets: [{ code: r.code }],
        batchSeq: batchSeq ? Number(batchSeq) : undefined,
      };
      if (kind === 'print') await printTicketsDirect(opts);
      else await printTickets(opts);
    } catch (e) {
      reportSilent('lot-tickets.action', e, { routerId, kind });
      setError(extractErrorMessage(e));
    } finally {
      setBusy(null);
    }
  }

  return (
    <View style={{ flex: 1, backgroundColor: theme.bg }}>
      <AppHeader title={batchSeq ? t('fichiers.ticketsOfLot', { seq: batchSeq }) : t('fichiers.viewTickets')} />
      <FlatList
        data={items}
        keyExtractor={(v) => v.id}
        contentContainerStyle={{ padding: space.lg, gap: space.md, paddingBottom: navHeight }}
        ListHeaderComponent={
          <View style={{ gap: space.md }}>
            <Title>{t('fichiers.viewTickets')}</Title>
            <Field
              label={t('fichiers.searchTickets')}
              value={search}
              onChangeText={setSearch}
              autoCapitalize="none"
              autoCorrect={false}
              placeholder="3d12…"
            />
            {error ? <Banner tone="danger">{error}</Banner> : null}
          </View>
        }
        renderItem={({ item }) => (
          <Card>
            <Row>
              <View style={{ flex: 1 }}>
                <Text style={{ color: theme.text, fontSize: 18, fontWeight: '700', letterSpacing: 1 }}>{item.code}</Text>
                <Text style={{ color: theme.textMuted, fontSize: 12 }}>
                  {item.plan.name} · {item.plan.priceXof} FCFA
                </Text>
              </View>
              <Badge label={TICKET_STATUS_LABEL[item.status]} tone={TICKET_STATUS_TONE[item.status]} />
            </Row>
            <Row style={{ gap: space.sm }}>
              {(['share', 'print', 'download'] as const).map((kind) => (
                <View key={kind} style={{ flex: 1 }}>
                  <Button
                    title={kind === 'share' ? t('common.share') : kind === 'print' ? t('common.print') : t('common.download')}
                    variant="ghost"
                    onPress={() => act(item, kind)}
                    loading={busy?.id === item.id && busy.kind === kind}
                    disabled={busy !== null || item.status === 'REVOKED'}
                  />
                </View>
              ))}
            </Row>
          </Card>
        )}
        ListEmptyComponent={
          query.isLoading ? (
            <View style={{ gap: space.md }}>
              <Skeleton height={96} />
              <Skeleton height={96} />
            </View>
          ) : query.isError ? (
            <ErrorState message={extractErrorMessage(query.error)} onRetry={() => query.refetch()} retrying={query.isRefetching} />
          ) : (
            <Empty text={t('fichiers.noTicketFound')} icon="ticket-outline" />
          )
        }
        ListFooterComponent={
          query.hasNextPage ? (
            <Button title={t('fichiers.loadMore')} variant="ghost" onPress={() => query.fetchNextPage()} loading={query.isFetchingNextPage} />
          ) : null
        }
      />
      <BottomNav />
    </View>
  );
}
