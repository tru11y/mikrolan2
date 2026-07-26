import { View, Text, Pressable } from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/src/lib/api';
import { theme } from './ui';

// Polled (no push infra yet) — good enough for near-real-time without device
// tokens/APNs/FCM. See skills_rn_otp… sibling note in project memory re: scope.
export function NotificationBell() {
  const router = useRouter();
  const unread = useQuery({
    queryKey: ['notifications', 'unread-count'],
    queryFn: api.notifications.unreadCount,
    refetchInterval: 15_000,
  });
  const count = unread.data ?? 0;

  return (
    <Pressable
      accessibilityLabel="Notifications"
      onPress={() => router.push('/notifications')}
      style={{
        width: 34,
        height: 34,
        borderRadius: 11,
        borderWidth: 1,
        borderColor: theme.border,
        backgroundColor: theme.surfaceAlt,
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <Ionicons name="notifications-outline" size={16} color={theme.text} />
      {count > 0 ? (
        <View
          style={{
            position: 'absolute',
            top: -3,
            right: -3,
            minWidth: 16,
            height: 16,
            borderRadius: 8,
            paddingHorizontal: 3,
            backgroundColor: theme.danger,
            alignItems: 'center',
            justifyContent: 'center',
            borderWidth: 1.5,
            borderColor: theme.surface,
          }}
        >
          <Text style={{ color: '#fff', fontSize: 9, fontWeight: '800' }}>
            {count > 9 ? '9+' : count}
          </Text>
        </View>
      ) : null}
    </Pressable>
  );
}
