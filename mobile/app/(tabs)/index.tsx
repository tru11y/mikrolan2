import { Image, ScrollView, View, Text, Pressable } from 'react-native';
import { Redirect, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';
import { api, type RouterItem } from '@/src/lib/api';
import { useActiveRouter } from '@/src/providers/active-router-provider';
import {
  AuroraCard,
  Badge,
  Card,
  Mono,
  Row,
  theme,
  Title,
  type IoniconName,
} from '@/src/components/ui';
import { BottomNav } from '@/src/components/BottomNav';

function initialsOf(name?: string): string {
  if (!name) return 'ML';
  const parts = name.trim().split(/\s+/);
  return (parts[0]?.[0] ?? 'M').concat(parts[1]?.[0] ?? '').toUpperCase();
}

function trialDaysLeft(end?: string | null): number | null {
  if (!end) return null;
  const ms = new Date(end).getTime() - Date.now();
  if (!Number.isFinite(ms) || ms <= 0) return null;
  return Math.ceil(ms / 86_400_000);
}

function StatCard({
  label,
  value,
  sub,
  subTone = 'muted',
  icon,
  iconColor,
  onPress,
}: {
  label: string;
  value: string;
  sub: string;
  subTone?: 'muted' | 'success' | 'secondary';
  icon: IoniconName;
  iconColor: string;
  onPress: () => void;
}) {
  const subColor =
    subTone === 'success'
      ? theme.success
      : subTone === 'secondary'
        ? theme.secondary
        : theme.textMuted;
  return (
    <Pressable
      onPress={onPress}
      style={{
        width: '48%',
        backgroundColor: theme.surface,
        borderWidth: 1,
        borderColor: theme.border,
        borderRadius: 18,
        padding: 14,
        gap: 6,
      }}
    >
      <Row>
        <Text style={{ color: theme.textMuted, fontSize: 12, fontWeight: '500' }}>
          {label}
        </Text>
        <View
          style={{
            width: 32,
            height: 32,
            borderRadius: 10,
            backgroundColor: iconColor + '22',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <Ionicons name={icon} size={16} color={iconColor} />
        </View>
      </Row>
      <Text style={{ color: theme.text, fontSize: 24, fontWeight: '800' }}>
        {value}
      </Text>
      <Text style={{ color: subColor, fontSize: 11 }}>{sub}</Text>
    </Pressable>
  );
}

export default function MaisonScreen() {
  const router = useRouter();
  const { isReady, activeRouterId } = useActiveRouter();
  const me = useQuery({ queryKey: ['me'], queryFn: api.auth.me });
  const routers = useQuery({ queryKey: ['routers'], queryFn: api.routers.list });
  const metrics = useQuery({
    queryKey: ['metrics', 'today'],
    queryFn: () => api.metrics.summary('today'),
  });

  const list: RouterItem[] = routers.data ?? [];
  const online = list.filter((r) => r.health === 'ONLINE').length;
  const isPro = me.data?.subscription?.plan === 'PRO';
  const tenantName = me.data?.tenant.name ?? 'MikroLan2';
  const firstName = tenantName.split(/\s+/)[0];
  const trial = !isPro
    ? trialDaysLeft(me.data?.subscription?.currentPeriodEnd)
    : null;

  // A router is already selected (persisted or just activated): Maison becomes
  // its dashboard and the bottom nav switches to router-connected mode.
  if (isReady && activeRouterId) {
    return <Redirect href={`/router/${activeRouterId}`} />;
  }

  return (
    <View style={{ flex: 1, backgroundColor: theme.bg }}>
    <ScrollView
      style={{ flex: 1, backgroundColor: theme.bg }}
      contentContainerStyle={{ padding: 16, gap: 16, paddingBottom: 100 }}
    >
      <Row style={{ gap: 8, justifyContent: 'flex-start' }}>
        <Image
          source={require('@/assets/images/logo.png')}
          style={{ width: 24, height: 24 }}
          resizeMode="contain"
        />
        <Text style={{ color: theme.text, fontSize: 14, fontWeight: '700' }}>
          MikroLan2
        </Text>
      </Row>

      {/* Welcome card */}
      <Card>
        <Row>
          <Row style={{ gap: 12, flex: 1, justifyContent: 'flex-start' }}>
            <View
              style={{
                width: 48,
                height: 48,
                borderRadius: 16,
                backgroundColor: theme.primary,
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <Text style={{ color: theme.primaryText, fontWeight: '800', fontSize: 18 }}>
                {initialsOf(tenantName)}
              </Text>
            </View>
            <View style={{ flex: 1 }}>
              <Text style={{ color: theme.text, fontSize: 17, fontWeight: '700' }}>
                Bienvenue, {firstName}
              </Text>
              <Row style={{ gap: 6, justifyContent: 'flex-start', marginTop: 2 }}>
                <View
                  style={{
                    width: 7,
                    height: 7,
                    borderRadius: 4,
                    backgroundColor: theme.success,
                  }}
                />
                <Text style={{ color: theme.textMuted, fontSize: 12 }}>
                  Compte administrateur vérifié
                </Text>
              </Row>
            </View>
          </Row>
          <Pressable
            onPress={() => router.push('/(tabs)/account')}
            style={{
              paddingHorizontal: 14,
              paddingVertical: 8,
              borderRadius: 12,
              borderWidth: 1,
              borderColor: theme.border,
              backgroundColor: theme.surfaceAlt,
            }}
          >
            <Text style={{ color: theme.textMuted, fontSize: 12, fontWeight: '600' }}>
              Profil
            </Text>
          </Pressable>
        </Row>
      </Card>

      {/* Aurora hero — revenue (today) */}
      <AuroraCard style={{ padding: 22 }}>
        <Text style={{ color: theme.primaryText, fontWeight: '600', opacity: 0.9 }}>
          Revenu du jour
        </Text>
        <Row style={{ alignItems: 'flex-end', justifyContent: 'flex-start', marginTop: 10 }}>
          <Text style={{ color: theme.primaryText, fontSize: 40, fontWeight: '800' }}>
            {metrics.isLoading
              ? '…'
              : (metrics.data?.revenueXof ?? 0).toLocaleString('fr-FR')}
          </Text>
          <Text
            style={{
              color: theme.primaryText,
              opacity: 0.8,
              marginBottom: 8,
              marginLeft: 8,
              fontWeight: '600',
            }}
          >
            FCFA
          </Text>
        </Row>
        <Text style={{ color: theme.primaryText, opacity: 0.8, fontSize: 12, marginTop: 4 }}>
          {metrics.data?.ticketsGenerated ?? 0} tickets vendus ·{' '}
          {metrics.data?.activeSessions ?? 0} sessions actives
        </Text>
      </AuroraCard>

      {/* Trial banner */}
      {trial != null ? (
        <Card style={{ borderColor: theme.warning, borderWidth: 1.5 }}>
          <Row>
            <Row style={{ gap: 12, flex: 1, justifyContent: 'flex-start' }}>
              <View
                style={{
                  width: 40,
                  height: 40,
                  borderRadius: 12,
                  backgroundColor: theme.warning + '22',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                <Ionicons name="time-outline" size={20} color={theme.warning} />
              </View>
              <View style={{ flex: 1 }}>
                <Text
                  style={{
                    color: theme.warning,
                    fontSize: 11,
                    fontWeight: '700',
                    letterSpacing: 0.5,
                  }}
                >
                  PÉRIODE D'ESSAI ACTIVE
                </Text>
                <Text style={{ color: theme.text, fontSize: 13, marginTop: 2 }}>
                  Il vous reste{' '}
                  <Text style={{ color: theme.warning, fontWeight: '700' }}>
                    {trial} jour{trial > 1 ? 's' : ''}
                  </Text>{' '}
                  d'essai complet.
                </Text>
              </View>
            </Row>
            <Pressable
              onPress={() => router.push('/pro')}
              style={{
                paddingHorizontal: 12,
                paddingVertical: 8,
                borderRadius: 12,
                backgroundColor: theme.warning,
              }}
            >
              <Text style={{ color: theme.goldText, fontWeight: '700', fontSize: 12 }}>
                Prolonger
              </Text>
            </Pressable>
          </Row>
        </Card>
      ) : null}

      {/* Prime banner */}
      {!isPro ? (
        <Pressable onPress={() => router.push('/pro')}>
          <Card style={{ borderColor: theme.gold, borderWidth: 1.5 }}>
            <Row>
              <Row style={{ gap: 12, flex: 1, justifyContent: 'flex-start' }}>
                <View
                  style={{
                    width: 40,
                    height: 40,
                    borderRadius: 12,
                    backgroundColor: theme.gold + '22',
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  <Ionicons name="diamond-outline" size={20} color={theme.gold} />
                </View>
                <View style={{ flex: 1, paddingRight: 8 }}>
                  <Row style={{ justifyContent: 'flex-start', gap: 8 }}>
                    <Text
                      style={{
                        color: theme.gold,
                        fontSize: 11,
                        fontWeight: '700',
                        letterSpacing: 0.5,
                      }}
                    >
                      PASS PRO UNLIMITED
                    </Text>
                    <Badge label="PRO" tone="gold" />
                  </Row>
                  <Text style={{ color: theme.textMuted, fontSize: 12, marginTop: 2 }}>
                    Multi-routeurs, cloud backup & impression thermique.
                  </Text>
                </View>
              </Row>
              <Ionicons name="chevron-forward" size={20} color={theme.textMuted} />
            </Row>
          </Card>
        </Pressable>
      ) : null}

      {/* 2x2 stats grid (clickable) */}
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 12 }}>
        <StatCard
          label="Routeurs"
          value={`${list.length}`}
          sub={`${online} en ligne`}
          subTone="success"
          icon="hardware-chip-outline"
          iconColor={theme.secondary}
          onPress={() => router.push('/(tabs)/routeurs')}
        />
        <StatCard
          label="Clients"
          value={`${metrics.data?.ticketsUsed ?? 0}`}
          sub="tickets utilisés"
          icon="people-circle-outline"
          iconColor={theme.primary}
          onPress={() => router.push('/(tabs)/rapport')}
        />
        <StatCard
          label="Tickets"
          value={`${metrics.data?.ticketsGenerated ?? 0}`}
          sub="générés aujourd'hui"
          icon="ticket-outline"
          iconColor={theme.gold}
          onPress={() => router.push('/(tabs)/tickets')}
        />
        <StatCard
          label="Sessions"
          value={`${metrics.data?.activeSessions ?? 0}`}
          sub="actifs live"
          subTone="secondary"
          icon="people-outline"
          iconColor={theme.success}
          onPress={() => router.push('/(tabs)/rapport')}
        />
      </View>

      {/* Routers section */}
      <Card style={{ gap: 12 }}>
        <Row>
          <Row style={{ gap: 8, justifyContent: 'flex-start' }}>
            <Ionicons name="hardware-chip" size={18} color={theme.primary} />
            <Text style={{ color: theme.text, fontWeight: '700', fontSize: 15 }}>
              Mes routeurs connectés
            </Text>
          </Row>
          <Pressable
            onPress={() => router.push('/add-router')}
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              gap: 4,
              paddingHorizontal: 10,
              paddingVertical: 7,
              borderRadius: 10,
              backgroundColor: theme.primary,
            }}
          >
            <Ionicons name="add" size={15} color={theme.primaryText} />
            <Text style={{ color: theme.primaryText, fontWeight: '700', fontSize: 12 }}>
              Ajouter
            </Text>
          </Pressable>
        </Row>

        {list.length === 0 ? (
          <Text style={{ color: theme.textMuted }}>
            Aucun routeur. Ajoutez-en un pour commencer.
          </Text>
        ) : (
          list.map((r) => (
            <Pressable key={r.id} onPress={() => router.push(`/router/${r.id}`)}>
              <View
                style={{
                  backgroundColor: theme.surfaceAlt,
                  borderWidth: 1,
                  borderColor: theme.border,
                  borderRadius: 14,
                  padding: 12,
                  flexDirection: 'row',
                  alignItems: 'center',
                  gap: 12,
                }}
              >
                <View
                  style={{
                    width: 44,
                    height: 44,
                    borderRadius: 12,
                    backgroundColor: theme.primary + '22',
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  <Ionicons
                    name="hardware-chip-outline"
                    size={22}
                    color={theme.primary}
                  />
                </View>
                <View style={{ flex: 1 }}>
                  <Row style={{ justifyContent: 'flex-start', gap: 8 }}>
                    <Text style={{ color: theme.text, fontWeight: '700', fontSize: 14 }}>
                      {r.alias || r.identity}
                    </Text>
                    <Badge
                      label={r.health === 'ONLINE' ? 'EN LIGNE' : 'HORS LIGNE'}
                      tone={r.health === 'ONLINE' ? 'secondary' : 'danger'}
                    />
                  </Row>
                  <Mono style={{ color: theme.textMuted, fontSize: 11, marginTop: 2 }}>
                    {r.model ? `${r.model} · ` : ''}
                    {r.identity}
                  </Mono>
                </View>
                <Ionicons name="chevron-forward" size={20} color={theme.textMuted} />
              </View>
            </Pressable>
          ))
        )}
      </Card>

      {/* Tickets quick info */}
      <Pressable onPress={() => router.push('/(tabs)/tickets')}>
        <Card style={{ gap: 8 }}>
          <Row style={{ gap: 8, justifyContent: 'flex-start' }}>
            <Ionicons name="ticket" size={18} color={theme.primary} />
            <Text style={{ color: theme.text, fontWeight: '700', fontSize: 15 }}>
              Aperçu rapide des Tickets
            </Text>
          </Row>
          <Text style={{ color: theme.textMuted, fontSize: 12, lineHeight: 18 }}>
            Sélectionnez un routeur pour générer, imprimer et exporter vos tickets
            WiFi au format thermique, PDF ou écran.
          </Text>
          <Row style={{ marginTop: 4 }}>
            <View
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                gap: 6,
                backgroundColor: theme.gold + '18',
                borderWidth: 1,
                borderColor: theme.gold + '33',
                borderRadius: 10,
                paddingHorizontal: 10,
                paddingVertical: 6,
              }}
            >
              <Ionicons name="information-circle-outline" size={14} color={theme.gold} />
              <Text style={{ color: theme.gold, fontSize: 11 }}>
                {metrics.data?.ticketsGenerated ?? 0} générés aujourd'hui
              </Text>
            </View>
            <Text style={{ color: theme.primary, fontWeight: '700', fontSize: 12 }}>
              Créer un ticket →
            </Text>
          </Row>
        </Card>
      </Pressable>
    </ScrollView>
    <BottomNav active="index" />
    </View>
  );
}
