import { useState } from 'react';
import { ScrollView, Text, View } from 'react-native';
import { useAuth } from '@/src/providers/auth-provider';
import { api, extractErrorMessage } from '@/src/lib/api';
import {
  Badge,
  Banner,
  Button,
  Card,
  Label,
  Screen,
  Subtitle,
  theme,
  Title,
} from '@/src/components/ui';

function Row({
  label,
  value,
  mono,
}: {
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <View style={{ gap: 4 }}>
      <Label>{label}</Label>
      <Text
        style={{
          color: theme.text,
          fontSize: mono ? 13 : 15,
          fontFamily: mono ? theme.mono : undefined,
        }}
      >
        {value}
      </Text>
    </View>
  );
}

export default function AccountScreen() {
  const { me, isPro, logout, isBusy, apiBaseUrl } = useAuth();
  const [upgrade, setUpgrade] = useState<
    { kind: 'idle' } | { kind: 'busy' } | { kind: 'done'; message: string } | { kind: 'error'; message: string }
  >({ kind: 'idle' });

  async function requestUpgrade() {
    setUpgrade({ kind: 'busy' });
    try {
      const res = await api.subscriptions.requestUpgrade();
      setUpgrade({ kind: 'done', message: res.instructions });
    } catch (e) {
      setUpgrade({ kind: 'error', message: extractErrorMessage(e) });
    }
  }

  return (
    <Screen>
      <ScrollView contentContainerStyle={{ gap: 16 }}>
        <Title>Compte</Title>

        <Card>
          <Row label="Organisation" value={me?.tenant.name ?? '—'} />
          <Row label="Email" value={me?.user.email ?? '—'} mono />
          <Row label="Rôle" value={me?.user.role ?? '—'} mono />
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
              tone={isPro ? 'gold' : 'muted'}
            />
          </View>
          <Subtitle>
            {isPro
              ? 'Gestion à distance activée (tunnel WireGuard).'
              : 'Plan gratuit : gestion locale (LAN) uniquement. Passez à PRO pour piloter vos routeurs à distance.'}
          </Subtitle>
          {!isPro ? (
            <>
              {upgrade.kind === 'done' ? (
                <Banner tone="success">{upgrade.message}</Banner>
              ) : null}
              {upgrade.kind === 'error' ? (
                <Banner tone="danger">{upgrade.message}</Banner>
              ) : null}
              <Button
                title={
                  upgrade.kind === 'done' ? 'Demande envoyée' : 'Passer à PRO'
                }
                variant="gold"
                onPress={requestUpgrade}
                loading={upgrade.kind === 'busy'}
                disabled={upgrade.kind === 'done'}
              />
            </>
          ) : null}
        </Card>

        <Card>
          <Row label="Serveur API" value={apiBaseUrl} mono />
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
