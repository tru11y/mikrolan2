import { View, Text, Pressable } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/src/lib/api';
import { NotificationBell } from './NotificationBell';
import { theme } from './ui';

export function TopBar() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const me = useQuery({ queryKey: ['me'], queryFn: api.auth.me });
  const initial = (me.data?.tenant.name ?? 'M').trim().charAt(0).toUpperCase();

  return (
    <View
      style={{
        paddingTop: insets.top,
        backgroundColor: theme.surface,
        borderBottomWidth: 1,
        borderBottomColor: theme.border,
      }}
    >
      <View
        style={{
          height: 54,
          paddingHorizontal: 16,
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'space-between',
        }}
      >
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
          <View
            style={{
              width: 34,
              height: 34,
              borderRadius: 11,
              backgroundColor: theme.primary,
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <Ionicons name="wifi" size={18} color={theme.primaryText} />
          </View>
          <Text style={{ color: theme.text, fontWeight: '800', fontSize: 17 }}>
            MikroLan2
          </Text>
        </View>

        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <NotificationBell />
          <Pressable
            accessibilityLabel="Passer à PRO"
            onPress={() => router.push('/pro')}
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              gap: 4,
              paddingHorizontal: 10,
              paddingVertical: 6,
              borderRadius: 10,
              backgroundColor: theme.gold,
            }}
          >
            <Ionicons name="diamond" size={13} color={theme.goldText} />
            <Text style={{ color: theme.goldText, fontWeight: '800', fontSize: 12 }}>
              PRO
            </Text>
          </Pressable>
          <Pressable
            accessibilityLabel="Compte"
            onPress={() => router.push('/(tabs)/account')}
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
            <Text style={{ color: theme.text, fontWeight: '700', fontSize: 13 }}>
              {initial}
            </Text>
          </Pressable>
        </View>
      </View>
    </View>
  );
}
