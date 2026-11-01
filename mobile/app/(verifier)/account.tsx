export { ScreenErrorBoundary as ErrorBoundary } from '@/src/components/ScreenErrorBoundary';
import Constants from 'expo-constants';
import { useRouter } from 'expo-router';
import { ScrollView, Text, View } from 'react-native';
import {
  Button,
  Card,
  Screen,
  Subtitle,
  Title,
  space,
  type,
} from '@/src/components/ui';
import { useTheme } from '@/src/providers/theme-provider';
import { useAuth } from '@/src/providers/auth-provider';

export default function VerifierAccount() {
  const theme = useTheme();
  const router = useRouter();
  const { me, logout, isBusy } = useAuth();
  const user = me?.user;
  const appVersion =
    (Constants.expoConfig?.version as string | undefined) ?? '—';

  return (
    <Screen>
      <ScrollView contentContainerStyle={{ padding: space.lg, gap: space.md }}>
        <Title>Mon compte</Title>
        <Subtitle>Vérificateur de tickets</Subtitle>

        <Card>
          <View style={{ gap: space.sm }}>
            {user?.name && (
              <View>
                <Text style={{ color: theme.textMuted, fontSize: type.caption }}>Nom</Text>
                <Text style={{ color: theme.text, fontSize: type.body }}>{user.name}</Text>
              </View>
            )}
            {user?.email && (
              <View>
                <Text style={{ color: theme.textMuted, fontSize: type.caption }}>Identifiant</Text>
                <Text style={{ color: theme.text, fontSize: type.body }}>{user.email}</Text>
              </View>
            )}
            <View>
              <Text style={{ color: theme.textMuted, fontSize: type.caption }}>Rôle</Text>
              <Text style={{ color: theme.text, fontSize: type.body }}>Vérificateur de tickets</Text>
            </View>
            <View>
              <Text style={{ color: theme.textMuted, fontSize: type.caption }}>Version</Text>
              <Text style={{ color: theme.text, fontSize: type.body }}>{appVersion}</Text>
            </View>
          </View>
        </Card>

        <View style={{ gap: space.sm, marginTop: space.md }}>
          <Button
            title="Retour à la vérification"
            variant="ghost"
            onPress={() => router.replace('/(verifier)/verify')}
          />
          <Button
            title="Se déconnecter"
            variant="danger"
            loading={isBusy}
            onPress={() => {
              void logout();
            }}
          />
        </View>
      </ScrollView>
    </Screen>
  );
}
