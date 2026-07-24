import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { QueryProvider } from '@/src/providers/query-provider';
import { AuthProvider } from '@/src/providers/auth-provider';
import { theme } from '@/src/components/ui';

export default function RootLayout() {
  return (
    <SafeAreaProvider>
      <QueryProvider>
        <AuthProvider>
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
            <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
            <Stack.Screen
              name="add-router"
              options={{ title: 'Ajouter un routeur', presentation: 'modal' }}
            />
            <Stack.Screen name="router/[id]" options={{ title: 'Routeur' }} />
            <Stack.Screen name="plans" options={{ title: 'Forfaits' }} />
            <Stack.Screen
              name="hotspot-setup"
              options={{ title: 'Configurer le hotspot' }}
            />
            <Stack.Screen
              name="generate-vouchers"
              options={{ title: 'Créer des tickets' }}
            />
            <Stack.Screen name="sessions" options={{ title: 'Sessions' }} />
            <Stack.Screen name="pro" options={{ title: 'MikroLan2 PRO' }} />
            <Stack.Screen
              name="router-settings"
              options={{ title: 'Paramètres routeur' }}
            />
          </Stack>
        </AuthProvider>
      </QueryProvider>
    </SafeAreaProvider>
  );
}
