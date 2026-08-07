import { ScrollView, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, type AppNotification } from '@/src/lib/api';
import { describeError } from '@/src/lib/errors';
import { useLiveEvents } from '@/src/providers/live-events-provider';
import {
  Empty,
  ErrorState,
  FadeIn,
  IconChip,
  Press,
  radius,
  Row,
  Skeleton,
  space,
  theme,
  type,
  useToast,
} from '@/src/components/ui';
import { BottomNav, useBottomNavHeight } from '@/src/components/BottomNav';
import { AppHeader } from '@/src/components/AppHeader';

function timeAgo(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const min = Math.floor(ms / 60_000);
  if (min < 1) return "à l'instant";
  if (min < 60) return `il y a ${min} min`;
  const h = Math.floor(min / 60);
  if (h < 24) return `il y a ${h} h`;
  return `il y a ${Math.floor(h / 24)} j`;
}

function iconFor(type: string): keyof typeof Ionicons.glyphMap {
  if (type === 'VOUCHER_ACTIVATED') return 'flash';
  return 'notifications';
}

/** Petit voyant : dit si le fil tourne, sans jargon technique. */
function LiveDot({ live }: { live: boolean }) {
  return (
    <Row style={{ gap: 6, justifyContent: 'flex-start' }}>
      <View
        style={{
          width: 7,
          height: 7,
          borderRadius: 4,
          backgroundColor: live ? theme.success : theme.textMuted,
        }}
      />
      <Text style={{ color: theme.textMuted, fontSize: type.micro }}>
        {live ? 'Suivi en direct' : 'En pause'}
      </Text>
    </Row>
  );
}

export default function NotificationsScreen() {
  const navHeight = useBottomNavHeight();
  const qc = useQueryClient();
  const toast = useToast();
  const { live } = useLiveEvents();

  const query = useQuery({
    queryKey: ['notifications', 'list'],
    queryFn: () => api.notifications.list(false, 50),
    refetchInterval: 10_000,
    placeholderData: keepPreviousData,
  });

  async function markRead(n: AppNotification) {
    if (n.read) return;
    try {
      await api.notifications.markRead(n.id);
      await qc.invalidateQueries({ queryKey: ['notifications'] });
    } catch (e) {
      toast.error(describeError(e).message);
    }
  }

  async function markAllRead() {
    try {
      await api.notifications.markAllRead();
      await qc.invalidateQueries({ queryKey: ['notifications'] });
    } catch (e) {
      toast.error(describeError(e).message);
    }
  }

  const items = query.data ?? [];
  const hasUnread = items.some((n) => !n.read);

  return (
    <View style={{ flex: 1, backgroundColor: theme.bg }}>
      <AppHeader title="Notifications" back />
      <ScrollView
        contentContainerStyle={{
          gap: space.md,
          padding: space.lg,
          paddingBottom: navHeight,
        }}
      >
        <Row>
          <LiveDot live={live} />
          {hasUnread ? (
            <Press accessibilityLabel="Tout marquer comme lu" onPress={markAllRead}>
              <Text style={{ color: theme.primary, fontWeight: '700', fontSize: type.body }}>
                Tout marquer comme lu
              </Text>
            </Press>
          ) : null}
        </Row>

        {query.isLoading ? (
          <View style={{ gap: space.md }}>
            {[0, 1, 2].map((i) => (
              <Skeleton key={i} height={78} radius={radius.lg} />
            ))}
          </View>
        ) : query.isError ? (
          <ErrorState
            message={describeError(query.error).message}
            onRetry={() => query.refetch()}
            retrying={query.isFetching}
          />
        ) : !items.length ? (
          <Empty
            icon="notifications-off-outline"
            text="Aucune notification. Vous serez prévenu dès qu’un client se connectera avec un ticket."
          />
        ) : (
          items.map((n, index) => (
            <FadeIn key={n.id} delay={index * 40}>
              <Press accessibilityLabel={n.title} onPress={() => markRead(n)} scaleTo={0.99}>
                <Row
                  style={{
                    gap: space.md,
                    padding: 14,
                    borderRadius: radius.lg,
                    backgroundColor: n.read ? theme.surface : theme.surfaceAlt,
                    borderWidth: 1,
                    borderColor: n.read ? theme.border : theme.primary + '55',
                    alignItems: 'flex-start',
                  }}
                >
                  <IconChip
                    name={iconFor(n.type)}
                    color={n.read ? theme.textMuted : theme.primary}
                    size="md"
                  />
                  <View style={{ flex: 1, gap: 2 }}>
                    <Row style={{ gap: space.sm }}>
                      <Text
                        style={{
                          color: theme.text,
                          fontWeight: '700',
                          fontSize: type.bodyLg - 1,
                          flex: 1,
                        }}
                      >
                        {n.title}
                      </Text>
                      {!n.read ? (
                        <View
                          style={{
                            width: 8,
                            height: 8,
                            borderRadius: 4,
                            backgroundColor: theme.primary,
                          }}
                        />
                      ) : null}
                    </Row>
                    <Text style={{ color: theme.textMuted, fontSize: type.body }}>
                      {n.body}
                    </Text>
                    <Text
                      style={{ color: theme.textMuted, fontSize: type.micro, marginTop: 2 }}
                    >
                      {timeAgo(n.createdAt)}
                    </Text>
                  </View>
                </Row>
              </Press>
            </FadeIn>
          ))
        )}
      </ScrollView>
      <BottomNav />
    </View>
  );
}
