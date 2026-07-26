import { Redirect, Tabs } from 'expo-router';
import { useAuth } from '@/src/providers/auth-provider';
import { TopBar } from '@/src/components/TopBar';

// The native tab bar is hidden — each screen renders its own <BottomNav>,
// which adapts its tab set to whether a router is currently selected (see
// ActiveRouterProvider + src/components/BottomNav.tsx). Tickets/Rapport stay
// routable (linked from Maison in global mode) but aren't global-mode bottom
// tabs — matching the MikroTicket reference, where ticket/report screens are
// only reachable once a router is selected.
export default function TabsLayout() {
  const { isReady, isAuthenticated } = useAuth();
  if (isReady && !isAuthenticated) return <Redirect href="/login" />;

  return (
    <Tabs
      screenOptions={{
        headerShown: true,
        header: () => <TopBar />,
        tabBarStyle: { display: 'none' },
      }}
    >
      <Tabs.Screen name="index" options={{ title: 'Maison' }} />
      <Tabs.Screen name="routeurs" options={{ title: 'Routeurs' }} />
      <Tabs.Screen
        name="tickets"
        options={{ title: 'Tickets', href: null }}
      />
      <Tabs.Screen
        name="rapport"
        options={{ title: 'Rapport', href: null, headerShown: false }}
      />
      <Tabs.Screen name="modeles" options={{ title: 'Modèles' }} />
      <Tabs.Screen name="account" options={{ title: 'Paramètres' }} />
    </Tabs>
  );
}
