export { ScreenErrorBoundary as ErrorBoundary } from '@/src/components/ScreenErrorBoundary';
import { reportSilent } from '@/src/lib/report';
import { useEffect, useState } from 'react';
import { Redirect } from 'expo-router';
import { ActivityIndicator, View } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useAuth } from '@/src/providers/auth-provider';
import { useTheme } from '@/src/providers/theme-provider';
import { ONBOARDING_KEY } from './onboarding';

export default function Index() {
  const { isReady, isAuthenticated, isRestoring, me } = useAuth();
  const theme = useTheme();
  const [onboardingDone, setOnboardingDone] = useState<boolean | null>(null);

  useEffect(() => {
    AsyncStorage.getItem(ONBOARDING_KEY).then((v) => setOnboardingDone(v === '1')).catch((e) => {
        reportSilent('onboarding.read', e);
        setOnboardingDone(false);
      });
  }, []);

  // `isRestoring` : jetons valides, profil pas encore rechargé (réseau coupé).
  // On attend sur l'écran de chargement plutôt que de renvoyer au login.
  if (!isReady || isRestoring || onboardingDone === null) {
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
  // Routing par rôle serveur. TICKET_VERIFIER n'entre jamais dans (tabs),
  // même brièvement : la redirection remplace l'historique.
  if (me?.user?.role === 'TICKET_VERIFIER') {
    return <Redirect href="/(verifier)/verify" />;
  }
  if (!onboardingDone) return <Redirect href="/onboarding" />;
  return <Redirect href="/(tabs)" />;
}
