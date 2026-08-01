import { Pressable, ScrollView, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api, type AppNotification } from '@/src/lib/api';
import { Empty, radius, space, theme, type } from '@/src/components/ui';
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

export default function NotificationsScreen() {
  const navHeight = useBottomNavHeight();
  const qc = useQueryClient();
  const query = useQuery({
    queryKey: ['notifications', 'list'],
    queryFn: () => api.notifications.list(false, 50),
    refetchInterval: 15_000,
  });

  async function markRead(n: AppNotification) {
    if (n.read) return;
    await api.notifications.markRead(n.id);
    await qc.invalidateQueries({ queryKey: ['notifications'] });
  }

  async function markAllRead() {
    await api.notifications.markAllRead();
    await qc.invalidateQueries({ queryKey: ['notifications'] });
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
        <View
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            justifyContent: 'flex-end',
          }}
        >
          {hasUnread ? (
            <Pressable onPress={markAllRead}>
              <Text style={{ color: theme.primary, fontWeight: '700', fontSize: 13 }}>
                Tout marquer comme lu
              </Text>
            </Pressable>
          ) : null}
        </View>

        {query.isLoading ? (
          <Text style={{ color: theme.textMuted }}>Chargement…</Text>
        ) : !items.length ? (
          <Empty text="Aucune notification pour l'instant." />
        ) : (
          items.map((n) => (
            <Pressable key={n.id} onPress={() => markRead(n)}>
              <View
                style={{
                  flexDirection: 'row',
                  gap: 12,
                  padding: 14,
                  borderRadius: 16,
                  backgroundColor: n.read ? theme.surface : theme.surfaceAlt,
                  borderWidth: 1,
                  borderColor: n.read ? theme.border : theme.primary + '55',
                }}
              >
                <View
                  style={{
                    width: 38,
                    height: 38,
                    borderRadius: 12,
                    backgroundColor: theme.primary + '22',
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  <Ionicons name={iconFor(n.type)} size={18} color={theme.primary} />
                </View>
                <View style={{ flex: 1, gap: 2 }}>
                  <View
                    style={{
                      flexDirection: 'row',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      gap: 8,
                    }}
                  >
                    <Text
                      style={{ color: theme.text, fontWeight: '700', fontSize: 14, flex: 1 }}
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
                  </View>
                  <Text style={{ color: theme.textMuted, fontSize: 13 }}>{n.body}</Text>
                  <Text style={{ color: theme.textMuted, fontSize: 11, marginTop: 2 }}>
                    {timeAgo(n.createdAt)}
                  </Text>
                </View>
              </View>
            </Pressable>
          ))
        )}
      </ScrollView>
      <BottomNav />
    </View>
  );
}
