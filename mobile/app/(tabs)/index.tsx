import { useCallback, useState } from 'react';
import { RefreshControl, ScrollView, View, Text } from 'react-native';
import { Link, Redirect, useFocusEffect, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { api, extractErrorMessage, type RouterHealth, type RouterItem } from '@/src/lib/api';
import { useActiveRouter } from '@/src/providers/active-router-provider';
import { useAuth } from '@/src/providers/auth-provider';
import { getLocalCredentials } from '@/src/lib/router-credentials';
import { getWifiInfo, sameSubnet24 } from '@/src/lib/lanBinder';
import { withApi } from '@/src/services/mikrotik-lan/MikroTikApiClient';
import { RouterStatusDot } from '@/src/components/RouterStatusDot';
import {
  AuroraCard,
  Banner,
  Card,
  Empty,
  ErrorState,
  icon,
  IconChip,
  Press,
  radius,
  routerHealth,
  Row,
  Skeleton,
  space,
  theme,
  type,
  weight,
  withAlpha,
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

type StatState = 'ready' | 'loading' | 'error';

// `flex: 1` et non `width: '48%'` : deux tuiles à 48 % plus une gouttière de
// 12 px débordaient sur un écran de 320 dp et retombaient sur une colonne.
function StatCard({
  label,
  value,
  sub,
  subTone = 'muted',
  icon: iconName,
  iconColor,
  onPress,
  state = 'ready',
}: {
  label: string;
  value: string;
  sub: string;
  subTone?: 'muted' | 'success';
  icon: IoniconName;
  iconColor: string;
  onPress: () => void;
  state?: StatState;
}) {
  const subColor = subTone === 'success' ? theme.success : theme.textMuted;
  const a11yValue = state === 'error' ? 'indisponible' : `${value}, ${sub}`;
  // `flex: 1` vit sur ce `View`, pas sur `Press` : le style de `Press`
  // s'applique à son `Animated.View` interne, un niveau trop profond pour
  // participer au partage de largeur entre siblings du `Row` parent — sans
  // ce conteneur, les 3 tuiles ne se partageaient pas la largeur également
  // (la plus longue en texte écrasait les autres jusqu'au retour à la ligne
  // lettre par lettre).
  return (
    <View style={{ flex: 1 }}>
      <Press
        accessibilityLabel={`${label}, ${a11yValue}`}
        onPress={onPress}
        style={{
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
            numberOfLines={1}
            style={{
              flex: 1,
              color: theme.textMuted,
              fontSize: type.caption,
              fontWeight: weight.medium,
            }}
          >
            {label}
          </Text>
          <IconChip name={iconName} color={iconColor} size="sm" />
        </Row>
        {state === 'loading' ? (
          <Skeleton height={26} width="55%" />
        ) : (
          <Text
            style={{
              color: state === 'error' ? theme.textMuted : theme.text,
              fontSize: type.h1,
              fontWeight: weight.heavy,
            }}
          >
            {state === 'error' ? '—' : value}
          </Text>
        )}
        {state === 'loading' ? (
          <Skeleton height={11} width="75%" />
        ) : (
          <Text
            numberOfLines={1}
            style={{
              color: state === 'error' ? theme.danger : subColor,
              fontSize: type.micro,
            }}
          >
            {state === 'error' ? 'Indisponible' : sub}
          </Text>
        )}
      </Press>
    </View>
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
  const tenantName = me.data?.tenant?.name ?? 'MikroLan2';
  const firstName = tenantName.split(/\s+/)[0];
  const isPro = entitlement.tier === 'PRO';
  const trial = entitlement.tier === 'TRIAL' ? entitlement.daysLeft : null;

  // Une erreur réseau ne doit jamais se lire comme « aucune activité » : on
  // distingue explicitement chargement / erreur sans donnée / erreur avec
  // cache (encore affichable, juste potentiellement pas à jour) / vrai zéro.
  const routersLoading = routers.isLoading;
  const routersErrored = routers.isError && !routers.data;
  const routersStale = routers.isError && Boolean(routers.data);
  const routersState: StatState = routersLoading ? 'loading' : routersErrored ? 'error' : 'ready';

  const metricsLoading = metrics.isLoading;
  const metricsErrored = metrics.isError && !metrics.data;
  const metricsStale = metrics.isError && Boolean(metrics.data);
  const metricsState: StatState = metricsLoading ? 'loading' : metricsErrored ? 'error' : 'ready';

  const anyStale = routersStale || metricsStale;

  function refreshAll() {
    routers.refetch();
    metrics.refetch();
    me.refetch();
  }

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
        refreshControl={
          <RefreshControl
            refreshing={routers.isRefetching || metrics.isRefetching}
            onRefresh={refreshAll}
            tintColor={theme.primary}
          />
        }
      >
      {/* Une seule bannière pour tout le tableau de bord : inutile de répéter
          le même avertissement sur chaque section touchée par l'erreur. */}
      {anyStale ? (
        <Banner tone="danger">
          Certaines informations peuvent ne pas être à jour. Tirez vers le bas
          pour réessayer.
        </Banner>
      ) : null}

      {/* Résumé opérationnel : identité du compte, pas de statut inventé. */}
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
                  fontWeight: weight.heavy,
                  fontSize: type.title,
                }}
              >
                {initialsOf(tenantName)}
              </Text>
            </View>
            <View style={{ flex: 1 }}>
              <Text
                numberOfLines={1}
                style={{ color: theme.text, fontSize: type.title, fontWeight: weight.bold }}
              >
                Bienvenue, {firstName}
              </Text>
              <Text
                numberOfLines={1}
                style={{ color: theme.textMuted, fontSize: type.caption, marginTop: 2 }}
              >
                {tenantName}
              </Text>
            </View>
          </Row>
          <Press
            accessibilityLabel="Voir mon profil"
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
            <Text style={{ color: theme.textMuted, fontSize: type.caption, fontWeight: weight.semibold }}>
              Profil
            </Text>
          </Press>
        </Row>
      </Card>

      {/* Indicateur financier principal — seul bloc en dégradé de l'écran. */}
      <AuroraCard>
        <Text style={{ color: theme.primaryText, fontWeight: weight.semibold, opacity: 0.9 }}>
          Revenu du jour
        </Text>
        {metricsState === 'loading' ? (
          <View style={{ marginTop: space.sm + 2 }}>
            <Skeleton
              height={40}
              width={170}
              style={{ backgroundColor: withAlpha(theme.onStrong, 0.25) }}
            />
          </View>
        ) : metricsState === 'error' ? (
          <Press
            accessibilityLabel="Revenu du jour indisponible, réessayer"
            onPress={() => metrics.refetch()}
            style={{ marginTop: space.sm + 2 }}
          >
            <Row style={{ justifyContent: 'flex-start', gap: space.sm }}>
              <Ionicons name="cloud-offline-outline" size={icon.lg} color={theme.primaryText} />
              <View>
                <Text style={{ color: theme.primaryText, fontSize: type.bodyLg, fontWeight: weight.bold }}>
                  Indisponible
                </Text>
                <Text style={{ color: theme.primaryText, opacity: 0.8, fontSize: type.micro }}>
                  Toucher pour réessayer
                </Text>
              </View>
            </Row>
          </Press>
        ) : (
          <Row style={{ alignItems: 'flex-end', justifyContent: 'flex-start', marginTop: space.sm + 2 }}>
            <Text style={{ color: theme.primaryText, fontSize: type.hero, fontWeight: weight.heavy }}>
              {(metrics.data?.revenueXof ?? 0).toLocaleString('fr-FR')}
            </Text>
            <Text
              style={{
                color: theme.primaryText,
                opacity: 0.8,
                marginBottom: space.sm,
                marginLeft: space.sm,
                fontWeight: weight.semibold,
              }}
            >
              FCFA
            </Text>
          </Row>
        )}
        {metricsState === 'ready' ? (
          <Text style={{ color: theme.primaryText, opacity: 0.8, fontSize: type.caption, marginTop: space.xs }}>
            {metrics.data?.ticketsGenerated ?? 0} tickets vendus ·{' '}
            {metrics.data?.activeSessions ?? 0} sessions actives
          </Text>
        ) : null}
      </AuroraCard>

      {/* État des routeurs — aperçu, pas une copie de l'écran Routeurs. */}
      <Card style={{ gap: space.md }}>
        <Row>
          <Row style={{ gap: space.sm, justifyContent: 'flex-start' }}>
            <Ionicons name="hardware-chip" size={icon.md} color={theme.primary} />
            <Text style={{ color: theme.text, fontWeight: weight.bold, fontSize: type.bodyLg }}>
              Mes routeurs
            </Text>
          </Row>
          <Press
            accessibilityLabel="Ajouter un routeur"
            accessibilityHint="Ouvre le formulaire de connexion à un nouveau routeur"
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
            <Text style={{ color: theme.primaryText, fontWeight: weight.bold, fontSize: type.caption }}>
              Ajouter
            </Text>
          </Press>
        </Row>

        {routersState === 'loading' ? (
          <View style={{ gap: space.sm }}>
            <Skeleton height={64} radius={radius.md} />
            <Skeleton height={64} radius={radius.md} />
          </View>
        ) : routersState === 'error' ? (
          <ErrorState
            compact
            message={extractErrorMessage(routers.error)}
            onRetry={() => routers.refetch()}
            retrying={routers.isRefetching}
          />
        ) : list.length === 0 ? (
          <Empty
            text="Aucun routeur pour l’instant. Ajoutez-en un pour commencer."
            icon="hardware-chip-outline"
            action={{ label: 'Ajouter un routeur', onPress: () => router.push('/add-router') }}
          />
        ) : (
          <View style={{ gap: space.sm }}>
            {list.slice(0, 3).map((r) => {
              const health = healthOf(r);
              const healthInfo = routerHealth(health);
              return (
                <Link key={r.id} href={`/router/${r.id}`} asChild>
                  <Press
                    accessibilityLabel={`${r.alias || r.identity}, ${healthInfo.label}`}
                    accessibilityHint="Ouvre le tableau de bord de ce routeur"
                  >
                    <Row
                      style={{
                        backgroundColor: theme.surfaceAlt,
                        borderWidth: 1,
                        borderColor: theme.border,
                        borderRadius: radius.md,
                        padding: space.md,
                        gap: space.md,
                      }}
                    >
                      <IconChip name="hardware-chip-outline" size="md" />
                      <View style={{ flex: 1 }}>
                        <Row style={{ justifyContent: 'flex-start', gap: space.sm }}>
                          <Text
                            numberOfLines={1}
                            style={{ flex: 1, color: theme.text, fontWeight: weight.bold, fontSize: type.body }}
                          >
                            {r.alias || r.identity}
                          </Text>
                          <RouterStatusDot health={health} />
                        </Row>
                        <Text numberOfLines={1} style={{ color: theme.textMuted, fontSize: type.micro, marginTop: 2 }}>
                          {healthInfo.label}
                          {r.model ? ` · ${r.model}` : ''}
                        </Text>
                      </View>
                      <Ionicons name="chevron-forward" size={icon.md} color={theme.textMuted} />
                    </Row>
                  </Press>
                </Link>
              );
            })}
            {list.length > 3 ? (
              <Press
                accessibilityLabel={`Voir tous les ${list.length} routeurs`}
                onPress={() => router.push('/(tabs)/routeurs')}
                style={{ alignItems: 'center', paddingVertical: space.sm }}
              >
                <Text style={{ color: theme.primary, fontWeight: weight.bold, fontSize: type.caption }}>
                  Voir tous les routeurs ({list.length})
                </Text>
              </Press>
            ) : null}
          </View>
        )}
      </Card>

      {/* Raccourcis — trois KPI distincts du résumé routeurs ci-dessus, pas de
          doublon (le compte de routeurs vit déjà dans la section au-dessus). */}
      <Row style={{ gap: space.md, alignItems: 'stretch' }}>
        <StatCard
          label="Clients"
          value={`${metrics.data?.ticketsUsed ?? 0}`}
          sub="tickets utilisés"
          icon="people-circle-outline"
          iconColor={theme.primary}
          state={metricsState}
          onPress={() => router.push('/(tabs)/rapport')}
        />
        <StatCard
          label="Tickets"
          value={`${metrics.data?.ticketsGenerated ?? 0}`}
          sub="générés aujourd'hui"
          icon="ticket-outline"
          iconColor={theme.primary}
          state={metricsState}
          onPress={() => router.push('/(tabs)/tickets')}
        />
        <StatCard
          label="Sessions"
          value={`${metrics.data?.activeSessions ?? 0}`}
          sub="actives"
          subTone="success"
          icon="people-outline"
          iconColor={theme.success}
          state={metricsState}
          onPress={() => router.push('/(tabs)/rapport')}
        />
      </Row>

      {/* Abonnement / essai — en dernier : utile, jamais prioritaire sur les
          opérations du jour. */}
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
                    fontWeight: weight.bold,
                    letterSpacing: 0.5,
                  }}
                >
                  PÉRIODE D'ESSAI ACTIVE
                </Text>
                <Text style={{ color: theme.text, fontSize: type.body, marginTop: 2 }}>
                  Encore{' '}
                  <Text style={{ color: theme.warning, fontWeight: weight.bold }}>
                    {trial} jour{trial > 1 ? 's' : ''}
                  </Text>
                  . Ensuite, l’accès à vos routeurs sera suspendu jusqu’à
                  l’activation d’un forfait.
                </Text>
              </View>
            </Row>
            <Press
              accessibilityLabel="Activer un forfait PRO"
              onPress={() => router.push('/pro')}
              style={{
                paddingHorizontal: space.md,
                paddingVertical: space.sm,
                borderRadius: radius.md,
                backgroundColor: theme.warning,
              }}
            >
              <Text style={{ color: theme.goldText, fontWeight: weight.bold, fontSize: type.caption }}>
                Activer
              </Text>
            </Press>
          </Row>
        </Card>
      ) : null}

      {!isPro ? (
        <Press
          accessibilityLabel="Découvrir le pass PRO"
          accessibilityHint="Ouvre la grille tarifaire de l'abonnement PRO"
          onPress={() => router.push('/pro')}
        >
          <Card style={{ borderColor: theme.gold, borderWidth: 1.5 }}>
            <Row>
              <Row style={{ gap: space.md, flex: 1, justifyContent: 'flex-start' }}>
                <IconChip name="diamond-outline" color={theme.gold} size="md" />
                <View style={{ flex: 1, paddingRight: space.sm }}>
                  <Text
                    style={{
                      color: theme.gold,
                      fontSize: type.micro,
                      fontWeight: weight.bold,
                      letterSpacing: 0.5,
                    }}
                  >
                    PASS PRO UNLIMITED
                  </Text>
                  <Text style={{ color: theme.textMuted, fontSize: type.caption, marginTop: 2 }}>
                    Multi-routeurs, cloud backup & impression thermique.
                  </Text>
                </View>
              </Row>
              <Ionicons name="chevron-forward" size={icon.md} color={theme.textMuted} />
            </Row>
          </Card>
        </Press>
      ) : null}
      </ScrollView>
      <BottomNav active="index" />
    </View>
  );
}
