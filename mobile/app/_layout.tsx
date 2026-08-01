import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { QueryProvider } from '@/src/providers/query-provider';
import { AuthProvider } from '@/src/providers/auth-provider';
import { AppLockProvider } from '@/src/providers/app-lock-provider';
import { ActiveRouterProvider } from '@/src/providers/active-router-provider';
import { LiveEventsProvider } from '@/src/providers/live-events-provider';
import { PaywallLock } from '@/src/components/PaywallLock';
import { theme, ToastProvider } from '@/src/components/ui';

export default function RootLayout() {
  return (
    <SafeAreaProvider>
      <QueryProvider>
        <ToastProvider>
          <AuthProvider>
            <AppLockProvider>
              <ActiveRouterProvider>
                <LiveEventsProvider>
                  <StatusBar style="light" />
                  {/* Aucun en-tête natif : chaque écran rend <AppHeader>, sans
                      quoi le nom de l'écran s'affichait deux fois et la
                      typographie changeait à chaque navigation. */}
                  <Stack
                    screenOptions={{
                      headerShown: false,
                      contentStyle: { backgroundColor: theme.bg },
                      // Glissement latéral partout : sans animation explicite
                      // expo-router coupait sec d'un écran à l'autre, ce qui
                      // faisait perdre le fil de la navigation.
                      animation: 'slide_from_right',
                      animationDuration: 220,
                      gestureEnabled: true,
                    }}
                  >
                    <Stack.Screen
                      name="add-router"
                      options={{
                        presentation: 'modal',
                        animation: 'slide_from_bottom',
                      }}
                    />
                    <Stack.Screen
                      name="pro"
                      options={{ animation: 'slide_from_bottom' }}
                    />
                    <Stack.Screen
                      name="notifications"
                      options={{ animation: 'slide_from_bottom' }}
                    />
                  </Stack>
                  <PaywallLock />
                </LiveEventsProvider>
              </ActiveRouterProvider>
            </AppLockProvider>
          </AuthProvider>
        </ToastProvider>
      </QueryProvider>
    </SafeAreaProvider>
  );
}
