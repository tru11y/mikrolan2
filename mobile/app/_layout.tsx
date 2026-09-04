import '@/src/i18n';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { Sentry } from '@/src/lib/sentry';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { QueryProvider } from '@/src/providers/query-provider';
import { AuthProvider } from '@/src/providers/auth-provider';
import { AppLockProvider } from '@/src/providers/app-lock-provider';
import { ActiveRouterProvider } from '@/src/providers/active-router-provider';
import { LiveEventsProvider } from '@/src/providers/live-events-provider';
import { PushNotificationsProvider } from '@/src/providers/push-notifications-provider';
import { PaywallLock } from '@/src/components/PaywallLock';
import { ErrorBoundary } from '@/src/components/ErrorBoundary';
import { ToastProvider } from '@/src/components/ui';
import { ThemeProvider, useTheme, useThemeMode } from '@/src/providers/theme-provider';

function AppContent() {
  const theme = useTheme();
  const { mode } = useThemeMode();
  return (
    <>
      <StatusBar style={mode === 'dark' ? 'light' : 'dark'} />
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
          name="onboarding"
          options={{ gestureEnabled: false, animation: 'fade' }}
        />
        <Stack.Screen
          name="login"
          options={{ gestureEnabled: false, animation: 'none' }}
        />
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
    </>
  );
}

function RootLayout() {
  return (
    <SafeAreaProvider>
      <ErrorBoundary>
        <ThemeProvider>
          <QueryProvider>
            <ToastProvider>
              <AuthProvider>
                <PushNotificationsProvider>
                  <AppLockProvider>
                    <ActiveRouterProvider>
                      <LiveEventsProvider>
                        <AppContent />
                      </LiveEventsProvider>
                    </ActiveRouterProvider>
                  </AppLockProvider>
                </PushNotificationsProvider>
              </AuthProvider>
            </ToastProvider>
          </QueryProvider>
        </ThemeProvider>
      </ErrorBoundary>
    </SafeAreaProvider>
  );
}

export default Sentry.wrap(RootLayout);
