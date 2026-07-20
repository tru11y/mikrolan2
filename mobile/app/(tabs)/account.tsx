import { ScrollView, Text, View } from 'react-native';
import { useAuth } from '@/src/providers/auth-provider';
import {
  Badge,
  Button,
  Card,
  Label,
  Screen,
  Subtitle,
  theme,
  Title,
} from '@/src/components/ui';

function Row({ label, value }: { label: string; value: string }) {
  return (
    <View style={{ gap: 4 }}>
      <Label>{label}</Label>
      <Text style={{ color: theme.text, fontSize: 15 }}>{value}</Text>
    </View>
  );
}

export default function AccountScreen() {
  const { me, isPro, logout, isBusy, apiBaseUrl } = useAuth();

  return (
    <Screen>
      <ScrollView contentContainerStyle={{ gap: 16 }}>
        <Title>Compte</Title>

        <Card>
          <Row label="Organisation" value={me?.tenant.name ?? '—'} />
          <Row label="Email" value={me?.user.email ?? '—'} />
          <Row label="Rôle" value={me?.user.role ?? '—'} />
        </Card>

        <Card>
          <View
            style={{
              flexDirection: 'row',
              justifyContent: 'space-between',
              alignItems: 'center',
            }}
          >
            <Label>Abonnement</Label>
            <Badge
              label={me?.subscription?.plan ?? 'FREE'}
              tone={isPro ? 'primary' : 'muted'}
            />
          </View>
          <Subtitle>
            {isPro
              ? 'Gestion à distance activée (tunnel WireGuard).'
              : 'Plan gratuit : gestion locale (LAN) uniquement. Passez à PRO pour piloter vos routeurs à distance.'}
          </Subtitle>
          {!isPro ? (
            <Button
              title="Passer à PRO"
              onPress={() => {
                /* Phase 3: flux d'abonnement (validation manuelle) */
              }}
              disabled
            />
          ) : null}
        </Card>

        <Card>
          <Row label="Serveur API" value={apiBaseUrl} />
        </Card>

        <Button
          title="Se déconnecter"
          variant="danger"
          onPress={logout}
          loading={isBusy}
        />
      </ScrollView>
    </Screen>
  );
}
