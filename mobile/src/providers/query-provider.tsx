import { useEffect, PropsWithChildren } from 'react';
import { AppState, Platform } from 'react-native';
import {
  focusManager,
  onlineManager,
  QueryClient,
  QueryClientProvider,
} from '@tanstack/react-query';
import NetInfo from '@react-native-community/netinfo';
import { invalidateLanProofs } from '@/src/lib/lanRouting';
import { Sentry } from '@/src/lib/sentry';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 2,
      retryDelay: (attempt) => Math.min(1000 * 2 ** attempt, 15_000),
      staleTime: 15_000,
      gcTime: 5 * 60 * 1000,
      refetchOnWindowFocus: true,
      refetchOnReconnect: 'always',
    },
    mutations: {
      retry: 1,
      retryDelay: 1000,
    },
  },
});

onlineManager.setEventListener((setOnline) => {
  return NetInfo.addEventListener((state) => {
    // Wi-Fi / passerelle / connexion changés : toute preuve d'identité LAN est caduque.
    invalidateLanProofs();
    const online = !!state.isConnected;
    setOnline(online);
    Sentry.addBreadcrumb({
      category: 'network',
      message: online
        ? `Online (${state.type})`
        : 'Offline',
      level: online ? 'info' : 'warning',
    });
  });
});

function useFocusRefetch() {
  useEffect(() => {
    const sub = AppState.addEventListener('change', (status) => {
      if (status === 'active') invalidateLanProofs();
      if (Platform.OS !== 'web') {
        focusManager.setFocused(status === 'active');
      }
      Sentry.addBreadcrumb({
        category: 'app.lifecycle',
        message: `AppState → ${status}`,
        level: 'info',
      });
    });
    return () => sub.remove();
  }, []);
}

export function QueryProvider({ children }: PropsWithChildren) {
  useFocusRefetch();
  return (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
}
