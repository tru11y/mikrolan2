import { Redirect, Stack } from 'expo-router';
import { ActivityIndicator, View } from 'react-native';
import { useAuth } from '@/src/providers/auth-provider';
import { useTheme } from '@/src/providers/theme-provider';

// Shell dédié TICKET_VERIFIER : empêche l'affichage d'un écran tenant,
// même brièvement. Un non-TICKET_VERIFIER est redirigé en silencieux ;
// un non authentifié repart au login. Le backend reste l'autorité finale.
export default function VerifierLayout() {
  const { isReady, isAuthenticated, me } = useAuth();
  const theme = useTheme();
  if (!isReady) {
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
  if (!isAuthenticated) return <Redirect href="/login" />;
  if (me?.user?.role !== 'TICKET_VERIFIER') return <Redirect href="/(tabs)" />;
  return (
    <Stack
      screenOptions={{
        headerShown: false,
        contentStyle: { backgroundColor: theme.bg },
        gestureEnabled: false,
      }}
    />
  );
}
