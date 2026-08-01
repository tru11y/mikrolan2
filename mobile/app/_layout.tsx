import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { QueryProvider } from '@/src/providers/query-provider';
import { AuthProvider } from '@/src/providers/auth-provider';
import { AppLockProvider } from '@/src/providers/app-lock-provider';
import { ActiveRouterProvider } from '@/src/providers/active-router-provider';
import { PaywallLock } from '@/src/components/PaywallLock';
import { theme } from '@/src/components/ui';

export default function RootLayout() {
  return (
    <SafeAreaProvider>
      <QueryProvider>
        <AuthProvider>
          <AppLockProvider>
            <ActiveRouterProvider>
              <StatusBar style="light" />
              {/* Aucun en-tête natif : chaque écran rend <AppHeader>, sans
                  quoi le nom de l'écran s'affichait deux fois et la
                  typographie changeait à chaque navigation. */}
              <Stack
                screenOptions={{
                  headerShown: false,
                  contentStyle: { backgroundColor: theme.bg },
                }}
              >
                <Stack.Screen
                  name="add-router"
                  options={{ presentation: 'modal' }}
                />
              </Stack>
              <PaywallLock />
            </ActiveRouterProvider>
          </AppLockProvider>
        </AuthProvider>
      </QueryProvider>
    </SafeAreaProvider>
  );
}
