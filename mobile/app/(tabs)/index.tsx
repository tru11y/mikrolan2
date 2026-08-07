import { useCallback, useState } from 'react';
import { ScrollView, View, Text, Pressable } from 'react-native';
import { Redirect, useFocusEffect, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { api, type RouterHealth, type RouterItem } from '@/src/lib/api';
import { useActiveRouter } from '@/src/providers/active-router-provider';
import { useAuth } from '@/src/providers/auth-provider';
import { getLocalCredentials } from '@/src/lib/router-credentials';
import { getWifiInfo, sameSubnet24 } from '@/src/lib/lanBinder';
import { withApi } from '@/src/services/mikrotik-lan/MikroTikApiClient';
import { RouterStatusDot } from '@/src/components/RouterStatusDot';
import {
  AuroraCard,
  Badge,
  Card,
  icon,
  IconChip,
  Mono,
  radius,
  routerHealth,
  Row,
  space,
  theme,
  type,
  type IoniconName,
} from '@/src/components/ui';
import { BottomNav, useBottomNavHeight } from '@/src/components/BottomNav';
import { AppHeader } from '@/src/components/AppHeader';

const LOCAL_PROBE_INTERVAL_MS = 15_000;
const LOCAL_PROBE_TIMEOUT_MS = 3_000;

function initialsOf(name?: string): string {
  if (!name) return 'ML';
  const parts = name.trim().split(/\s+/);
  return (parts[0]?.[0] ?? 'M').concat(parts[1]?.[0] ?? '').toUpperCase();
}

function StatCard({
  label,
  value,
  sub,
  subTone = 'muted',
  icon: iconName,
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
  // `flex: 1` et non `width: '48%'` : deux tuiles à 48 % plus une gouttière de
  // 12 px débordaient sur un écran de 320 dp et retombaient sur une colonne.
  return (
    <Pressable
      onPress={onPress}
      style={{
        flex: 1,
        backgroundColor: theme.surface,
        borderWidth: 1,
        borderColor: theme.border,
        borderRadius: radius.lg,
        padding: space.lg - 2,
        gap: space.xs + 2,
      }}
    >
      <Row style={{ alignItems: 'flex-start' }}>
        <Text
          style={{
            flex: 1,
            color: theme.textMuted,
            fontSize: type.caption,
            fontWeight: '500',
          }}
        >
          {label}
        </Text>
        <IconChip name={iconName} color={iconColor} size="sm" />
      </Row>
      <Text style={{ color: theme.text, fontSize: type.h1, fontWeight: '800' }}>
        {value}
      </Text>
      <Text style={{ color: subColor, fontSize: type.micro }}>{sub}</Text>
    </Pressable>
  );
}

export default function MaisonScreen() {
  const router = useRouter();
  const { isReady, activeRouterId } = useActiveRouter();
  const navHeight = useBottomNavHeight();
  const { entitlement } = useAuth();
  const me = useQuery({ queryKey: ['me'], queryFn: api.auth.me, placeholderData: keepPreviousData });
  const routers = useQuery({
    queryKey: ['routers'],
    queryFn: api.routers.list,
    refetchInterval: 15_000,
    placeholderData: keepPreviousData,
  });
  const metrics = useQuery({
    queryKey: ['metrics', 'today'],
    queryFn: () => api.metrics.summary('today'),
    placeholderData: keepPreviousData,
  });

  const list: RouterItem[] = routers.data ?? [];

  // Un routeur LOCAL n'est joignable que depuis le LAN du téléphone — le
  // serveur ne peut pas le savoir (health reste UNKNOWN en base). On ne
  // peut physiquement être connecté qu'à un seul LAN à la fois, donc on
  // sonde uniquement celui dont l'hôte correspond au Wi-Fi courant.
  const [localProbe, setLocalProbe] = useState<{
    routerId: string;
    health: RouterHealth;
  } | null>(null);

  const probeLocalRouter = useCallback(async () => {
    const wifi = await getWifiInfo();
    if (!wifi) {
      setLocalProbe(null);
      return;
    }
    for (const r of list) {
      if (r.mode !== 'LOCAL') continue;
      const creds = await getLocalCredentials(r.id);
      if (!creds) continue;
      const onLan =
        creds.host === wifi.gateway || sameSubnet24(creds.host, wifi.ipAddress);
      if (!onLan) continue;
      try {
        await withApi(
          { ...creds, timeoutMs: LOCAL_PROBE_TIMEOUT_MS },
          (c) => c.systemResource(),
        );
        setLocalProbe({ routerId: r.id, health: 'ONLINE' });
      } catch {
        setLocalProbe({ routerId: r.id, health: 'OFFLINE' });
      }
      return;
    }
    setLocalProbe(null);
  }, [list]);

  useFocusEffect(
    useCallback(() => {
      void probeLocalRouter();
      const timer = setInterval(() => void probeLocalRouter(), LOCAL_PROBE_INTERVAL_MS);
      return () => clearInterval(timer);
    }, [probeLocalRouter]),
  );

  function healthOf(r: RouterItem): RouterHealth {
    return r.mode === 'LOCAL' && localProbe?.routerId === r.id
      ? localProbe.health
      : r.health;
  }

  const online = list.filter((r) => healthOf(r) === 'ONLINE').length;
  const tenantName = me.data?.tenant.name ?? 'MikroLan2';
  const firstName = tenantName.split(/\s+/)[0];
  const isPro = entitlement.tier === 'PRO';
  const trial = entitlement.tier === 'TRIAL' ? entitlement.daysLeft : null;

  // A router is already selected (persisted or just activated): Maison becomes
  // its dashboard and the bottom nav switches to router-connected mode.
  if (isReady && activeRouterId) {
    return <Redirect href={`/router/${activeRouterId}`} />;
  }

  return (
    <View style={{ flex: 1, backgroundColor: theme.bg }}>
      <AppHeader title="Maison" />
      <ScrollView
        style={{ flex: 1, backgroundColor: theme.bg }}
        contentContainerStyle={{
          padding: space.lg,
          gap: space.lg,
          paddingBottom: navHeight,
        }}
      >
      {/* Welcome card */}
      <Card>
        <Row>
          <Row style={{ gap: space.md, flex: 1, justifyContent: 'flex-start' }}>
            <View
              style={{
                width: 48,
                height: 48,
                borderRadius: radius.lg,
                backgroundColor: theme.primary,
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <Text
                style={{
                  color: theme.primaryText,
                  fontWeight: '800',
                  fontSize: type.title,
                }}
              >
                {initialsOf(tenantName)}
              </Text>
            </View>
            <View style={{ flex: 1 }}>
              <Text style={{ color: theme.text, fontSize: type.title, fontWeight: '700' }}>
                Bienvenue, {firstName}
              </Text>
              <Row style={{ gap: space.xs + 2, justifyContent: 'flex-start', marginTop: 2 }}>
                <View
                  style={{
                    width: 7,
                    height: 7,
                    borderRadius: 4,
                    backgroundColor: theme.success,
                  }}
                />
                <Text style={{ color: theme.textMuted, fontSize: type.caption }}>
                  Compte administrateur vérifié
                </Text>
              </Row>
            </View>
          </Row>
          <Pressable
            onPress={() => router.push('/(tabs)/account')}
            style={{
              paddingHorizontal: space.lg - 2,
              paddingVertical: space.sm,
              borderRadius: radius.md,
              borderWidth: 1,
              borderColor: theme.border,
              backgroundColor: theme.surfaceAlt,
            }}
          >
            <Text style={{ color: theme.textMuted, fontSize: type.caption, fontWeight: '600' }}>
              Profil
            </Text>
          </Pressable>
        </Row>
      </Card>

      {/* Aurora hero — revenue (today) */}
      <AuroraCard>
        <Text style={{ color: theme.primaryText, fontWeight: '600', opacity: 0.9 }}>
          Revenu du jour
        </Text>
        <Row style={{ alignItems: 'flex-end', justifyContent: 'flex-start', marginTop: space.sm + 2 }}>
          <Text style={{ color: theme.primaryText, fontSize: type.hero, fontWeight: '800' }}>
            {metrics.isLoading
              ? '…'
              : (metrics.data?.revenueXof ?? 0).toLocaleString('fr-FR')}
          </Text>
          <Text
            style={{
              color: theme.primaryText,
              opacity: 0.8,
              marginBottom: space.sm,
              marginLeft: space.sm,
              fontWeight: '600',
            }}
          >
            FCFA
          </Text>
        </Row>
        <Text style={{ color: theme.primaryText, opacity: 0.8, fontSize: type.caption, marginTop: space.xs }}>
          {metrics.data?.ticketsGenerated ?? 0} tickets vendus ·{' '}
          {metrics.data?.activeSessions ?? 0} sessions actives
        </Text>
      </AuroraCard>

      {/* Trial banner */}
      {trial != null ? (
        <Card style={{ borderColor: theme.warning, borderWidth: 1.5 }}>
          <Row>
            <Row style={{ gap: space.md, flex: 1, justifyContent: 'flex-start' }}>
              <IconChip name="time-outline" color={theme.warning} size="md" />
              <View style={{ flex: 1 }}>
                <Text
                  style={{
                    color: theme.warning,
                    fontSize: type.micro,
                    fontWeight: '700',
                    letterSpacing: 0.5,
                  }}
                >
                  PÉRIODE D'ESSAI ACTIVE
                </Text>
                <Text style={{ color: theme.text, fontSize: type.body, marginTop: 2 }}>
                  Encore{' '}
                  <Text style={{ color: theme.warning, fontWeight: '700' }}>
                    {trial} jour{trial > 1 ? 's' : ''}
                  </Text>
                  . Ensuite, l’accès à vos routeurs sera suspendu jusqu’à
                  l’activation d’un forfait.
                </Text>
              </View>
            </Row>
            <Pressable
              onPress={() => router.push('/pro')}
              style={{
                paddingHorizontal: space.md,
                paddingVertical: space.sm,
                borderRadius: radius.md,
                backgroundColor: theme.warning,
              }}
            >
              <Text style={{ color: theme.goldText, fontWeight: '700', fontSize: type.caption }}>
                Activer
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
              <Row style={{ gap: space.md, flex: 1, justifyContent: 'flex-start' }}>
                <IconChip name="diamond-outline" color={theme.gold} size="md" />
                <View style={{ flex: 1, paddingRight: space.sm }}>
                  <Row style={{ justifyContent: 'flex-start', gap: space.sm }}>
                    <Text
                      style={{
                        color: theme.gold,
                        fontSize: type.micro,
                        fontWeight: '700',
                        letterSpacing: 0.5,
                      }}
                    >
                      PASS PRO UNLIMITED
                    </Text>
                    <Badge label="PRO" tone="gold" />
                  </Row>
                  <Text style={{ color: theme.textMuted, fontSize: type.caption, marginTop: 2 }}>
                    Multi-routeurs, cloud backup & impression thermique.
                  </Text>
                </View>
              </Row>
              <Ionicons name="chevron-forward" size={icon.md} color={theme.textMuted} />
            </Row>
          </Card>
        </Pressable>
      ) : null}

      {/* Grille 2×2 (cliquable) — deux rangées de `flex: 1`, hauteurs alignées */}
      <View style={{ gap: space.md }}>
        <Row style={{ gap: space.md, alignItems: 'stretch' }}>
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
        </Row>
        <Row style={{ gap: space.md, alignItems: 'stretch' }}>
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
            sub="actives maintenant"
            subTone="secondary"
            icon="people-outline"
            iconColor={theme.success}
            onPress={() => router.push('/(tabs)/rapport')}
          />
        </Row>
      </View>

      {/* Routers section */}
      <Card style={{ gap: space.md }}>
        <Row>
          <Row style={{ gap: space.sm, justifyContent: 'flex-start' }}>
            <Ionicons name="hardware-chip" size={icon.md} color={theme.primary} />
            <Text style={{ color: theme.text, fontWeight: '700', fontSize: type.bodyLg }}>
              Mes routeurs connectés
            </Text>
          </Row>
          <Pressable
            onPress={() => router.push('/add-router')}
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              gap: space.xs,
              paddingHorizontal: space.md,
              paddingVertical: space.sm,
              borderRadius: radius.sm,
              backgroundColor: theme.primary,
            }}
          >
            <Ionicons name="add" size={icon.sm} color={theme.primaryText} />
            <Text style={{ color: theme.primaryText, fontWeight: '700', fontSize: type.caption }}>
              Ajouter
            </Text>
          </Pressable>
        </Row>

        {list.length === 0 ? (
          <Text style={{ color: theme.textMuted }}>
            Aucun routeur. Ajoutez-en un pour commencer.
          </Text>
        ) : (
          list.map((r) => {
            const health = healthOf(r);
            return (
            <Pressable key={r.id} onPress={() => router.push(`/router/${r.id}`)}>
              <View
                style={{
                  backgroundColor: theme.surfaceAlt,
                  borderWidth: 1,
                  borderColor: theme.border,
                  borderRadius: radius.md,
                  padding: space.md,
                  flexDirection: 'row',
                  alignItems: 'center',
                  gap: space.md,
                }}
              >
                <IconChip name="hardware-chip-outline" size="md" />
                <View style={{ flex: 1 }}>
                  <Row style={{ justifyContent: 'flex-start', gap: space.sm }}>
                    <Text style={{ color: theme.text, fontWeight: '700', fontSize: type.body }}>
                      {r.alias || r.identity}
                    </Text>
                    <RouterStatusDot health={health} />
                    <Badge
                      label={routerHealth(health).label}
                      tone={routerHealth(health).tone}
                    />
                  </Row>
                  <Mono style={{ color: theme.textMuted, fontSize: type.micro, marginTop: 2 }}>
                    {r.model ? `${r.model} · ` : ''}
                    {r.identity}
                  </Mono>
                </View>
                <Ionicons name="chevron-forward" size={icon.md} color={theme.textMuted} />
              </View>
            </Pressable>
            );
          })
        )}
      </Card>

      {/* Tickets quick info */}
      <Pressable onPress={() => router.push('/(tabs)/tickets')}>
        <Card style={{ gap: space.sm }}>
          <Row style={{ gap: space.sm, justifyContent: 'flex-start' }}>
            <Ionicons name="ticket" size={icon.md} color={theme.primary} />
            <Text style={{ color: theme.text, fontWeight: '700', fontSize: type.bodyLg }}>
              Aperçu rapide des Tickets
            </Text>
          </Row>
          <Text style={{ color: theme.textMuted, fontSize: type.caption, lineHeight: 18 }}>
            Sélectionnez un routeur pour générer, imprimer et exporter vos tickets
            WiFi au format thermique, PDF ou écran.
          </Text>
          <Row style={{ marginTop: space.xs }}>
            <View
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                gap: space.xs + 2,
                backgroundColor: theme.gold + '18',
                borderWidth: 1,
                borderColor: theme.gold + '33',
                borderRadius: radius.sm,
                paddingHorizontal: space.md,
                paddingVertical: space.xs + 2,
              }}
            >
              <Ionicons name="information-circle-outline" size={icon.sm} color={theme.gold} />
              <Text style={{ color: theme.gold, fontSize: type.micro }}>
                {metrics.data?.ticketsGenerated ?? 0} générés aujourd'hui
              </Text>
            </View>
            <Text style={{ color: theme.primary, fontWeight: '700', fontSize: type.caption }}>
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
