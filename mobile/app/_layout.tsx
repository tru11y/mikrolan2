import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { QueryProvider } from '@/src/providers/query-provider';
import { AuthProvider } from '@/src/providers/auth-provider';
import { ActiveRouterProvider } from '@/src/providers/active-router-provider';
import { theme } from '@/src/components/ui';

export default function RootLayout() {
  return (
    <SafeAreaProvider>
      <QueryProvider>
        <AuthProvider>
          <ActiveRouterProvider>
            <StatusBar style="light" />
            <Stack
              screenOptions={{
                headerStyle: { backgroundColor: theme.surface },
                headerTintColor: theme.text,
                contentStyle: { backgroundColor: theme.bg },
              }}
            >
              <Stack.Screen name="index" options={{ headerShown: false }} />
              <Stack.Screen name="login" options={{ headerShown: false }} />
              <Stack.Screen name="verify-email" options={{ headerShown: false }} />
              <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
              <Stack.Screen
                name="add-router"
                options={{ title: 'Ajouter un routeur', presentation: 'modal' }}
              />
              <Stack.Screen name="router/[id]" options={{ headerShown: false }} />
              <Stack.Screen name="plans" options={{ headerShown: false }} />
              <Stack.Screen
                name="hotspot-setup"
                options={{ title: 'Configurer le hotspot' }}
              />
              <Stack.Screen
                name="generate-vouchers"
                options={{ headerShown: false }}
              />
              <Stack.Screen name="sessions" options={{ title: 'Sessions' }} />
              <Stack.Screen
                name="fichiers"
                options={{ headerShown: false }}
              />
              <Stack.Screen name="pro" options={{ title: 'MikroLan2 PRO' }} />
              <Stack.Screen
                name="router-settings"
                options={{ title: 'Paramètres routeur' }}
              />
              <Stack.Screen
                name="ip-bindings"
                options={{ title: 'IP Bindings & MAC' }}
              />
              <Stack.Screen
                name="internet-sharing"
                options={{ title: 'Partage Internet' }}
              />
              <Stack.Screen
                name="ticket-settings"
                options={{ title: 'Paramètres du ticket' }}
              />
            </Stack>
          </ActiveRouterProvider>
        </AuthProvider>
      </QueryProvider>
    </SafeAreaProvider>
  );
}
