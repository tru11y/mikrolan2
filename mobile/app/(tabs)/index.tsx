import { ScrollView, View, Text, Pressable } from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';
import { api, type RouterItem } from '@/src/lib/api';
import {
  AuroraCard,
  Badge,
  Button,
  Card,
  Mono,
  Row,
  SectionTitle,
  Stat,
  Subtitle,
  theme,
  Title,
} from '@/src/components/ui';

function initialsOf(name?: string): string {
  if (!name) return 'ML';
  const parts = name.trim().split(/\s+/);
  return (parts[0]?.[0] ?? 'M').concat(parts[1]?.[0] ?? '').toUpperCase();
}

export default function MaisonScreen() {
  const router = useRouter();
  const me = useQuery({ queryKey: ['me'], queryFn: api.auth.me });
  const routers = useQuery({ queryKey: ['routers'], queryFn: api.routers.list });
  const plans = useQuery({ queryKey: ['plans'], queryFn: api.plans.list });

  const list: RouterItem[] = routers.data ?? [];
  const online = list.filter((r) => r.health === 'ONLINE').length;
  const isPro = me.data?.subscription?.plan === 'PRO';
  const tenantName = me.data?.tenant.name ?? 'MikroLan2';

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: theme.bg }}
      contentContainerStyle={{ padding: 16, gap: 16, paddingBottom: 32 }}
    >
      {/* Header */}
      <Row>
        <Row style={{ gap: 12, justifyContent: 'flex-start', flex: 1 }}>
          <View
            style={{
              width: 44,
              height: 44,
              borderRadius: 22,
              backgroundColor: theme.primary,
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <Text style={{ color: theme.primaryText, fontWeight: '700' }}>
              {initialsOf(tenantName)}
            </Text>
          </View>
          <View>
            <Title>Bonjour</Title>
            <Subtitle>{tenantName}</Subtitle>
          </View>
        </Row>
        <Pressable
          accessibilityLabel="Notifications"
          hitSlop={8}
          style={{ padding: 8 }}
        >
          <Ionicons name="notifications-outline" size={22} color={theme.text} />
        </Pressable>
      </Row>

      {/* Aurora hero — revenue (metrics endpoint TODO) */}
      <AuroraCard>
        <Text style={{ color: theme.primaryText, fontWeight: '600', opacity: 0.9 }}>
          Revenu du jour
        </Text>
        <Row style={{ alignItems: 'flex-end', marginTop: 6 }}>
          <Text style={{ color: theme.primaryText, fontSize: 34, fontWeight: '800' }}>
            —
          </Text>
          <Text
            style={{
              color: theme.primaryText,
              opacity: 0.8,
              marginBottom: 6,
              marginLeft: 6,
            }}
          >
            FCFA
          </Text>
        </Row>
        <Text style={{ color: theme.primaryText, opacity: 0.75, fontSize: 12 }}>
          Statistiques de ventes bientôt disponibles
        </Text>
      </AuroraCard>

      {/* KPI tiles (real data) */}
      <Row style={{ gap: 12, alignItems: 'stretch' }}>
        <Stat
          value={`${online}/${list.length}`}
          label="Routeurs en ligne"
          tone="secondary"
        />
        <Stat value={`${plans.data?.length ?? 0}`} label="Forfaits" tone="gold" />
        <Stat value={isPro ? 'PRO' : 'Local'} label="Abonnement" tone="primary" />
      </Row>

      {/* PRO upsell (only when FREE) */}
      {!isPro ? (
        <Card style={{ borderColor: theme.gold }}>
          <Row>
            <View style={{ flex: 1, paddingRight: 12 }}>
              <Badge label="PRO" tone="gold" />
              <Text style={{ color: theme.text, fontWeight: '700', marginTop: 6 }}>
                Gérez vos routeurs à distance
              </Text>
              <Text style={{ color: theme.textMuted, fontSize: 13 }}>
                Tunnel WireGuard, cloud & impression — passez à PRO.
              </Text>
            </View>
            <View style={{ width: 120 }}>
              <Button
                title="Découvrir"
                variant="gold"
                onPress={() => router.push('/(tabs)/account')}
              />
            </View>
          </Row>
        </Card>
      ) : null}

      {/* Routeurs summary */}
      <View>
        <Row style={{ marginBottom: 8 }}>
          <SectionTitle>Routeurs</SectionTitle>
          <Pressable onPress={() => router.push('/(tabs)/routeurs')}>
            <Text style={{ color: theme.primary, fontWeight: '600' }}>Voir tout</Text>
          </Pressable>
        </Row>
        {list.length === 0 ? (
          <Card>
            <Text style={{ color: theme.textMuted }}>
              Aucun routeur. Ajoutez-en un pour commencer.
            </Text>
            <Button
              title="Ajouter un routeur"
              onPress={() => router.push('/add-router')}
            />
          </Card>
        ) : (
          <View style={{ gap: 12 }}>
            {list.slice(0, 3).map((r) => (
              <Pressable
                key={r.id}
                onPress={() => router.push(`/router/${r.id}`)}
              >
                <Card>
                  <Row>
                    <View style={{ flex: 1 }}>
                      <Text style={{ color: theme.text, fontWeight: '700' }}>
                        {r.alias || r.identity}
                      </Text>
                      <Mono style={{ color: theme.textMuted, fontSize: 12 }}>
                        {r.identity}
                        {r.localAddress ? ` · ${r.localAddress}` : ''}
                      </Mono>
                    </View>
                    <Badge
                      label={r.health === 'ONLINE' ? 'EN LIGNE' : 'HORS LIGNE'}
                      tone={r.health === 'ONLINE' ? 'secondary' : 'danger'}
                    />
                  </Row>
                </Card>
              </Pressable>
            ))}
          </View>
        )}
      </View>

      <Button
        title="+ Générer des tickets"
        onPress={() => router.push('/(tabs)/routeurs')}
      />
    </ScrollView>
  );
}
