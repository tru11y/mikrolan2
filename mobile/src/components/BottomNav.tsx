import { View, Text, Pressable } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter, type Href } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { theme, type IoniconName } from './ui';

const TABS: { key: string; label: string; icon: IoniconName; href: Href }[] = [
  { key: 'index', label: 'Maison', icon: 'home-outline', href: '/(tabs)' },
  {
    key: 'routeurs',
    label: 'Routeurs',
    icon: 'hardware-chip-outline',
    href: '/(tabs)/routeurs',
  },
  { key: 'tickets', label: 'Tickets', icon: 'ticket-outline', href: '/(tabs)/tickets' },
  { key: 'rapport', label: 'Rapport', icon: 'bar-chart-outline', href: '/(tabs)/rapport' },
  { key: 'account', label: 'Compte', icon: 'person-outline', href: '/(tabs)/account' },
];

// Persistent bottom nav for stack screens (so the tab bar never disappears).
export function BottomNav({ active }: { active?: string }) {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  return (
    <View
      style={{
        position: 'absolute',
        left: 0,
        right: 0,
        bottom: 0,
        backgroundColor: theme.surface,
        borderTopWidth: 1,
        borderTopColor: theme.border,
        paddingBottom: insets.bottom || 6,
        paddingTop: 6,
        flexDirection: 'row',
      }}
    >
      {TABS.map((t) => {
        const on = t.key === active;
        return (
          <Pressable
            key={t.key}
            accessibilityLabel={t.label}
            onPress={() => router.navigate(t.href)}
            style={{ flex: 1, alignItems: 'center', gap: 2, paddingVertical: 4 }}
          >
            <Ionicons
              name={t.icon}
              size={22}
              color={on ? theme.primary : theme.textMuted}
            />
            <Text
              style={{
                fontSize: 11,
                fontWeight: '600',
                color: on ? theme.primary : theme.textMuted,
              }}
            >
              {t.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}
