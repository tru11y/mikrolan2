import { Redirect, Tabs } from 'expo-router';
import { useAuth } from '@/src/providers/auth-provider';

// No native chrome at all: the tab bar is hidden (each screen renders its own
// <BottomNav>, which adapts to whether a router is selected) and the header is
// hidden too (each screen renders <AppHeader>). Mixing the native header with
// in-page titles is what made the same screen name appear twice.
export default function TabsLayout() {
  const { isReady, isAuthenticated } = useAuth();
  if (isReady && !isAuthenticated) return <Redirect href="/login" />;

  return (
    <Tabs
      screenOptions={{ headerShown: false, tabBarStyle: { display: 'none' } }}
    >
      <Tabs.Screen name="index" options={{ title: 'Maison' }} />
      <Tabs.Screen name="routeurs" options={{ title: 'Routeurs' }} />
      <Tabs.Screen name="tickets" options={{ title: 'Tickets', href: null }} />
      <Tabs.Screen name="rapport" options={{ title: 'Rapport', href: null }} />
      <Tabs.Screen name="account" options={{ title: 'Paramètres' }} />
    </Tabs>
  );
}
