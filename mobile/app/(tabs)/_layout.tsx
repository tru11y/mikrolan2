import { Redirect, Tabs } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from '@/src/providers/auth-provider';
import { theme } from '@/src/components/ui';
import { TopBar } from '@/src/components/TopBar';

type IoniconName = keyof typeof Ionicons.glyphMap;

export default function TabsLayout() {
  const { isReady, isAuthenticated } = useAuth();
  if (isReady && !isAuthenticated) return <Redirect href="/login" />;

  const icon =
    (name: IoniconName) =>
    ({ color, size }: { color: string; size: number }) => (
      <Ionicons name={name} size={size} color={color} />
    );

  return (
    <Tabs
      screenOptions={{
        headerShown: true,
        header: () => <TopBar />,
        tabBarStyle: {
          backgroundColor: theme.surface,
          borderTopColor: theme.border,
          height: 62,
          paddingTop: 6,
          paddingBottom: 8,
        },
        tabBarLabelStyle: { fontSize: 11, fontWeight: '600' },
        tabBarActiveTintColor: theme.primary,
        tabBarInactiveTintColor: theme.textMuted,
      }}
    >
      <Tabs.Screen
        name="index"
        options={{ title: 'Maison', tabBarIcon: icon('home-outline') }}
      />
      <Tabs.Screen
        name="routeurs"
        options={{ title: 'Routeurs', tabBarIcon: icon('hardware-chip-outline') }}
      />
      <Tabs.Screen
        name="tickets"
        options={{ title: 'Tickets', tabBarIcon: icon('ticket-outline') }}
      />
      <Tabs.Screen
        name="rapport"
        options={{ title: 'Rapport', tabBarIcon: icon('bar-chart-outline') }}
      />
      <Tabs.Screen
        name="account"
        options={{ title: 'Compte', tabBarIcon: icon('person-outline') }}
      />
    </Tabs>
  );
}
