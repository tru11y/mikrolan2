import { useState } from 'react';
import { Pressable, ScrollView, View, Text } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { api, type MetricsPeriod } from '@/src/lib/api';
import { exportMetricsCsv } from '@/src/lib/metricsCsv';
import {
  Badge,
  Card,
  Empty,
  icon,
  Mono,
  Row,
  SectionTitle,
  space,
  Subtitle,
  theme,
  Title,
  type,
} from '@/src/components/ui';
import { BottomNav, useBottomNavHeight } from '@/src/components/BottomNav';
import { AppHeader } from '@/src/components/AppHeader';
import { useActiveRouter } from '@/src/providers/active-router-provider';

const PERIODS: { label: string; value: MetricsPeriod }[] = [
  { label: "Aujourd'hui", value: 'today' },
  { label: 'Cette Semaine', value: '7d' },
  { label: 'Ce Mois', value: '30d' },
];

export default function RapportScreen() {
  const { routerId } = useLocalSearchParams<{ routerId?: string }>();
  const { activeRouterId } = useActiveRouter();
  const navHeight = useBottomNavHeight();
  const [period, setPeriod] = useState<MetricsPeriod>('30d');
  const metrics = useQuery({
    queryKey: ['metrics', period, routerId],
    queryFn: () => api.metrics.summary(period, routerId),
    placeholderData: keepPreviousData,
  });
  const clients = useQuery({
    queryKey: ['clients', routerId],
    queryFn: () => api.metrics.recentClients(30, routerId),
    refetchInterval: 15_000,
    placeholderData: keepPreviousData,
  });
  const data = metrics.data;
  const maxRevenue = Math.max(1, ...(data?.byPlan.map((p) => p.revenueXof) ?? []));

  return (
    <View style={{ flex: 1, backgroundColor: theme.bg }}>
    <AppHeader title="Rapport financier" back={Boolean(activeRouterId)} />
    <ScrollView
      style={{ flex: 1, backgroundColor: theme.bg }}
      contentContainerStyle={{
        padding: space.lg,
        gap: space.lg,
        paddingBottom: navHeight,
      }}
    >
      <Row>
        <View style={{ flex: 1 }}>
          <Subtitle>Statistiques de vente de tickets WiFi</Subtitle>
        </View>
        <Pressable
          onPress={() => {
            if (!data) return;
            const periodLabel = PERIODS.find((p) => p.value === period)!.label;
            exportMetricsCsv(data, periodLabel);
          }}
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            gap: 6,
            backgroundColor: theme.surface,
            borderWidth: 1,
            borderColor: theme.border,
            borderRadius: 12,
            paddingHorizontal: 10,
            paddingVertical: 10,
          }}
        >
          <Ionicons name="download-outline" size={16} color={theme.secondary} />
          <Text style={{ color: theme.textMuted, fontSize: 12, fontWeight: '700' }}>
            Exporter CSV
          </Text>
        </Pressable>
      </Row>

      {/* Filtre de période */}
      <Row
        style={{
          backgroundColor: theme.surface,
          borderWidth: 1,
          borderColor: theme.border,
          borderRadius: 16,
          padding: 6,
          gap: 4,
        }}
      >
        {PERIODS.map((p) => {
          const active = p.value === period;
          return (
            <Pressable
              key={p.value}
              onPress={() => setPeriod(p.value)}
              style={{
                flex: 1,
                paddingVertical: 8,
                borderRadius: 12,
                alignItems: 'center',
                backgroundColor: active ? theme.primary : 'transparent',
              }}
            >
              <Text
                style={{
                  color: active ? theme.primaryText : theme.textMuted,
                  fontSize: 12,
                  fontWeight: '700',
                }}
              >
                {p.label}
              </Text>
            </Pressable>
          );
        })}
      </Row>

      {/* Chiffre d'affaires total */}
      <Card style={{ gap: 8 }}>
        <Text
          style={{
            color: theme.textMuted,
            fontSize: 11,
            fontWeight: '700',
            letterSpacing: 0.5,
          }}
        >
          CHIFFRE D'AFFAIRES TOTAL
        </Text>
        <Mono style={{ color: theme.success, fontSize: 30, fontWeight: '900' }}>
          {metrics.isLoading ? '…' : (data?.revenueXof ?? 0).toLocaleString('fr-FR')} FCFA
        </Mono>
        {data?.trendPct != null ? (
          // La couleur suit le signe : une baisse de chiffre d'affaires
          // s'affichait en vert, avec une flèche descendante verte.
          (() => {
            const up = data.trendPct >= 0;
            const trendColor = up ? theme.success : theme.danger;
            return (
              <Row style={{ justifyContent: 'flex-start', gap: space.xs + 2 }}>
                <Ionicons
                  name={up ? 'trending-up' : 'trending-down'}
                  size={icon.sm}
                  color={trendColor}
                />
                <Text style={{ color: trendColor, fontSize: type.caption, flex: 1 }}>
                  {up ? '+' : ''}
                  {data.trendPct.toFixed(0)}% par rapport à la période précédente (
                  {data.ticketsUsed} tickets vendus)
                </Text>
              </Row>
            );
          })()
        ) : null}
      </Card>

      {/* Répartition par forfait */}
      <Card style={{ gap: 12 }}>
        <Row style={{ gap: 8, justifyContent: 'flex-start' }}>
          <Ionicons name="pie-chart-outline" size={16} color={theme.primary} />
          <Text style={{ color: theme.text, fontSize: 14, fontWeight: '700' }}>
            Répartition par forfait
          </Text>
        </Row>

        {!data?.byPlan.length ? (
          <Empty text="Aucune vente sur cette période." />
        ) : (
          <View style={{ gap: 10 }}>
            {data.byPlan.map((p) => (
              <View key={p.planId} style={{ gap: 4 }}>
                <Row>
                  <Text style={{ color: theme.text, fontSize: 12, fontWeight: '600' }}>
                    {p.planName}
                  </Text>
                  <Mono style={{ color: theme.success, fontSize: 12, fontWeight: '700' }}>
                    {p.revenueXof.toLocaleString('fr-FR')} FCFA ({p.sold} tickets)
                  </Mono>
                </Row>
                <View
                  style={{
                    height: 8,
                    borderRadius: 999,
                    backgroundColor: theme.surfaceAlt,
                    overflow: 'hidden',
                  }}
                >
                  <View
                    style={{
                      height: 8,
                      borderRadius: 999,
                      backgroundColor: theme.primary,
                      width: `${(p.revenueXof / maxRevenue) * 100}%`,
                    }}
                  />
                </View>
              </View>
            ))}
          </View>
        )}
      </Card>

      {/* Clients récents (hors réf, fonctionnalité réelle) */}
      <View>
        <SectionTitle>Clients récents</SectionTitle>
        {!clients.data?.length ? (
          <Empty text="Aucun ticket utilisé pour le moment." />
        ) : (
          <View style={{ gap: 12 }}>
            {clients.data.map((c) => (
              <Card key={c.voucherId} style={{ gap: 6 }}>
                <Row>
                  <Mono style={{ color: theme.text, fontSize: 15 }}>{c.code}</Mono>
                  <Badge
                    label={c.online ? 'En ligne' : 'Utilisé'}
                    tone={c.online ? 'success' : 'muted'}
                  />
                </Row>
                <Text style={{ color: theme.textMuted, fontSize: 12 }}>
                  {c.planName} · {c.priceXof.toLocaleString('fr-FR')} FCFA ·{' '}
                  {c.routerName}
                </Text>
                {c.macAddress || c.ipAddress ? (
                  <Mono style={{ color: theme.textMuted, fontSize: 11 }}>
                    {[c.ipAddress, c.macAddress].filter(Boolean).join(' · ')}
                  </Mono>
                ) : null}
              </Card>
            ))}
          </View>
        )}
      </View>
    </ScrollView>
    <BottomNav active="rapport" />
    </View>
  );
}
