import { useState } from 'react';
import { ScrollView, Text, View } from 'react-native';
import Constants from 'expo-constants';
import { useAuth } from '@/src/providers/auth-provider';
import { api, extractErrorMessage } from '@/src/lib/api';
import {
  Badge,
  Banner,
  Button,
  Card,
  Label,
  Row,
  Subtitle,
  theme,
  Title,
} from '@/src/components/ui';

function DetailRow({
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

function initialsOf(name?: string): string {
  if (!name) return 'ML';
  const p = name.trim().split(/\s+/);
  return (p[0]?.[0] ?? 'M').concat(p[1]?.[0] ?? '').toUpperCase();
}

export default function AccountScreen() {
  const { me, isPro, logout, isBusy, apiBaseUrl } = useAuth();
  const [upgrade, setUpgrade] = useState<
    | { kind: 'idle' }
    | { kind: 'busy' }
    | { kind: 'done'; message: string }
    | { kind: 'error'; message: string }
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

  const version = Constants.expoConfig?.version ?? '0.1.0';

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: theme.bg }}
      contentContainerStyle={{ padding: 16, gap: 16, paddingBottom: 32 }}
    >
      <Title>Compte</Title>

      {/* Profile */}
      <Card>
        <Row style={{ justifyContent: 'flex-start', gap: 14 }}>
          <View
            style={{
              width: 52,
              height: 52,
              borderRadius: 26,
              backgroundColor: theme.primary,
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <Text style={{ color: theme.primaryText, fontWeight: '700', fontSize: 18 }}>
              {initialsOf(me?.tenant.name)}
            </Text>
          </View>
          <View style={{ flex: 1, gap: 4 }}>
            <Text style={{ color: theme.text, fontWeight: '700', fontSize: 16 }}>
              {me?.tenant.name ?? '—'}
            </Text>
            <Text
              style={{
                color: theme.textMuted,
                fontSize: 13,
                fontFamily: theme.mono,
              }}
            >
              {me?.user.email ?? '—'}
            </Text>
            <Badge label="Compte vérifié" tone="success" />
          </View>
        </Row>
      </Card>

      {/* Subscription */}
      <Card style={{ borderColor: theme.gold }}>
        <Row>
          <Label>Abonnement</Label>
          <Badge label={me?.subscription?.plan ?? 'FREE'} tone={isPro ? 'gold' : 'muted'} />
        </Row>
        <Subtitle>
          {isPro
            ? 'Gestion à distance activée (tunnel WireGuard).'
            : 'Plan gratuit : gestion locale (LAN). Passez à PRO pour piloter vos routeurs à distance.'}
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
              title={upgrade.kind === 'done' ? 'Demande envoyée' : 'Passer à PRO'}
              variant="gold"
              onPress={requestUpgrade}
              loading={upgrade.kind === 'busy'}
              disabled={upgrade.kind === 'done'}
            />
          </>
        ) : null}
      </Card>

      {/* Network */}
      <Card>
        <DetailRow label="Rôle" value={me?.user.role ?? '—'} mono />
        <DetailRow label="Serveur API" value={apiBaseUrl} mono />
      </Card>

      <Button
        title="Se déconnecter"
        variant="danger"
        onPress={logout}
        loading={isBusy}
      />

      <Text style={{ color: theme.textMuted, fontSize: 12, textAlign: 'center' }}>
        MikroLan2 v{version}
      </Text>
    </ScrollView>
  );
}
