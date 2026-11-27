import { Redirect, Tabs } from 'expo-router';
import { ActivityIndicator, View } from 'react-native';
import { useAuth } from '@/src/providers/auth-provider';
import { useTheme } from '@/src/providers/theme-provider';

export default function TabsLayout() {
  const { isReady, isAuthenticated, isRestoring, me } = useAuth();
  const theme = useTheme();
  // Session valide en cours de restauration (réseau coupé) : on patiente au
  // lieu de renvoyer au login, sinon une coupure passagère simule une
  // déconnexion.
  if (isRestoring) {
    return (
      <View
        style={{
          flex: 1,
          backgroundColor: theme.bg,
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <ActivityIndicator color={theme.primary} size="large" />
      </View>
    );
  }
  if (isReady && !isAuthenticated) return <Redirect href="/login" />;
  // Un TICKET_VERIFIER ne doit jamais monter l'arbre tenant, même par deep
  // link ou retour arrière. Le routeur serveur reste l'autorité, mais le
  // mobile empêche l'exposition visuelle.
  if (isReady && me?.user?.role === 'TICKET_VERIFIER') {
    return <Redirect href="/(verifier)/verify" />;
  }

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
