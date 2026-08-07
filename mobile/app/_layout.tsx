import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { QueryProvider } from '@/src/providers/query-provider';
import { AuthProvider } from '@/src/providers/auth-provider';
import { AppLockProvider } from '@/src/providers/app-lock-provider';
import { ActiveRouterProvider } from '@/src/providers/active-router-provider';
import { LiveEventsProvider } from '@/src/providers/live-events-provider';
import { PushNotificationsProvider } from '@/src/providers/push-notifications-provider';
import { PaywallLock } from '@/src/components/PaywallLock';
import { theme, ToastProvider } from '@/src/components/ui';

export default function RootLayout() {
  return (
    <SafeAreaProvider>
      <QueryProvider>
        <ToastProvider>
          <AuthProvider>
            <PushNotificationsProvider>
              <AppLockProvider>
                <ActiveRouterProvider>
                  <LiveEventsProvider>
                    <StatusBar style="light" />
                    <Stack
                      screenOptions={{
                        headerShown: false,
                        contentStyle: { backgroundColor: theme.bg },
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
            </PushNotificationsProvider>
          </AuthProvider>
        </ToastProvider>
      </QueryProvider>
    </SafeAreaProvider>
  );
}
