import { useState } from 'react';
import { ScrollView, View, Text } from 'react-native';
import { useQuery } from '@tanstack/react-query';
import { api, type MetricsPeriod } from '@/src/lib/api';
import {
  Card,
  Empty,
  Mono,
  Pill,
  Row,
  SectionTitle,
  Stat,
  Subtitle,
  theme,
  Title,
} from '@/src/components/ui';

const PERIODS: { label: string; value: MetricsPeriod }[] = [
  { label: 'Aujourd’hui', value: 'today' },
  { label: '7 jours', value: '7d' },
  { label: '30 jours', value: '30d' },
];

export default function RapportScreen() {
  const [period, setPeriod] = useState<MetricsPeriod>('30d');
  const metrics = useQuery({
    queryKey: ['metrics', period],
    queryFn: () => api.metrics.summary(period),
  });
  const data = metrics.data;
  const maxRevenue = Math.max(1, ...(data?.byPlan.map((p) => p.revenueXof) ?? []));

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: theme.bg }}
      contentContainerStyle={{ padding: 16, gap: 16, paddingBottom: 32 }}
    >
      <View>
        <Title>Rapports & Revenus</Title>
        <Subtitle>Statistiques de vente de tickets WiFi</Subtitle>
      </View>

      <Row style={{ justifyContent: 'flex-start', gap: 8 }}>
        {PERIODS.map((p) => (
          <Pill
            key={p.value}
            label={p.label}
            active={p.value === period}
            onPress={() => setPeriod(p.value)}
          />
        ))}
      </Row>

      <Card>
        <Text style={{ color: theme.textMuted, fontSize: 12 }}>
          CHIFFRE D’AFFAIRES
        </Text>
        <Row style={{ alignItems: 'flex-end', justifyContent: 'flex-start', marginTop: 4 }}>
          <Text style={{ color: theme.success, fontSize: 30, fontWeight: '800' }}>
            {metrics.isLoading
              ? '…'
              : (data?.revenueXof ?? 0).toLocaleString('fr-FR')}
          </Text>
          <Text style={{ color: theme.textMuted, marginLeft: 6, marginBottom: 6 }}>
            FCFA
          </Text>
        </Row>
      </Card>

      <Row style={{ gap: 12, alignItems: 'stretch' }}>
        <Stat
          value={`${data?.ticketsGenerated ?? 0}`}
          label="Tickets vendus"
          tone="primary"
        />
        <Stat value={`${data?.ticketsUsed ?? 0}`} label="Utilisés" tone="secondary" />
        <Stat
          value={`${data?.activeSessions ?? 0}`}
          label="Sessions actives"
          tone="gold"
        />
      </Row>

      <View>
        <SectionTitle>Répartition par forfait</SectionTitle>
        {!data?.byPlan.length ? (
          <Empty text="Aucune vente sur cette période." />
        ) : (
          <View style={{ gap: 12 }}>
            {data.byPlan.map((p) => (
              <Card key={p.planId} style={{ gap: 8 }}>
                <Row>
                  <Text style={{ color: theme.text, fontWeight: '700' }}>
                    {p.planName}
                  </Text>
                  <Mono style={{ color: theme.text }}>
                    {p.revenueXof.toLocaleString('fr-FR')} FCFA
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
                <Text style={{ color: theme.textMuted, fontSize: 12 }}>
                  {p.sold} ticket(s) · {p.priceXof.toLocaleString('fr-FR')} FCFA
                  l’unité
                </Text>
              </Card>
            ))}
          </View>
        )}
      </View>
    </ScrollView>
  );
}
