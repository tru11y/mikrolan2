import { useCallback, useState } from 'react';
import { RefreshControl, ScrollView, Text, View } from 'react-native';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Ionicons } from '@expo/vector-icons';
import {
  api,
  type RevenueByPeriodItem,
  type RevenueByRouterItem,
  type InvoiceItem,
} from '@/src/lib/api';
import {
  Card,
  Empty,
  ErrorState,
  Label,
  Row,
  Skeleton,
  space,
  Subtitle,
  theme,
  Title,
  type,
  weight,
  withAlpha,
} from '@/src/components/ui';
import { BottomNav, useBottomNavHeight } from '@/src/components/BottomNav';
import { AppHeader } from '@/src/components/AppHeader';

function fmtXof(n: number): string {
  return new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 0 }).format(n) + ' F';
}

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleDateString('fr-FR', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

const STATUS_LABEL: Record<InvoiceItem['status'], string> = {
  DRAFT: 'Brouillon',
  SENT: 'Envoyée',
  PAID: 'Payée',
  OVERDUE: 'En retard',
};
const STATUS_COLOR: Record<InvoiceItem['status'], string> = {
  DRAFT: theme.textMuted,
  SENT: theme.primary,
  PAID: theme.success,
  OVERDUE: theme.danger,
};

function RevenueChart({ data }: { data: RevenueByPeriodItem[] }) {
  if (!data.length) return null;
  const max = Math.max(...data.map((d) => d.totalXof), 1);
  const recent = data.slice(-6);

  return (
    <Card style={{ gap: space.md }}>
      <Label>CA mensuel (6 derniers mois)</Label>
      <View style={{ gap: space.xs }}>
        {recent.map((d) => {
          const pct = (d.totalXof / max) * 100;
          return (
            <View key={`${d.year}-${d.monthNum}`} style={{ gap: 2 }}>
              <Row>
                <Text style={{ color: theme.textMuted, fontSize: type.caption, width: 50 }}>
                  {d.month.slice(0, 3)}
                </Text>
                <Text
                  style={{
                    color: theme.text,
                    fontSize: type.caption,
                    fontWeight: weight.bold,
                  }}
                >
                  {fmtXof(d.totalXof)}
                </Text>
              </Row>
              <View
                style={{
                  height: 6,
                  borderRadius: 3,
                  backgroundColor: withAlpha(theme.primary, 0.15),
                }}
              >
                <View
                  style={{
                    height: 6,
                    borderRadius: 3,
                    width: `${Math.max(pct, 2)}%`,
                    backgroundColor: theme.primary,
                  }}
                />
              </View>
            </View>
          );
        })}
      </View>
    </Card>
  );
}

function RouterBreakdown({ data }: { data: RevenueByRouterItem[] }) {
  if (!data.length) {
    return <Empty text="Aucune donnée par routeur." icon="hardware-chip-outline" />;
  }
  const total = data.reduce((s, d) => s + d.totalXof, 0) || 1;

  return (
    <Card style={{ gap: space.md }}>
      <Label>CA par routeur</Label>
      <View style={{ gap: space.sm }}>
        {data.map((d) => (
          <Row key={d.routerId}>
            <View style={{ flex: 1, gap: 2 }}>
              <Text style={{ color: theme.text, fontSize: type.caption }}>
                {d.routerName}
              </Text>
              <Text style={{ color: theme.textMuted, fontSize: 11 }}>
                {d.transactionCount} transaction{d.transactionCount > 1 ? 's' : ''}
              </Text>
            </View>
            <View style={{ alignItems: 'flex-end' }}>
              <Text
                style={{
                  color: theme.success,
                  fontSize: type.caption,
                  fontWeight: weight.bold,
                }}
              >
                {fmtXof(d.totalXof)}
              </Text>
              <Text style={{ color: theme.textMuted, fontSize: 11 }}>
                {Math.round((d.totalXof / total) * 100)}%
              </Text>
            </View>
          </Row>
        ))}
      </View>
    </Card>
  );
}

function InvoiceList({ data }: { data: InvoiceItem[] }) {
  if (!data.length) {
    return <Empty text="Aucune facture." icon="document-text-outline" />;
  }

  return (
    <Card style={{ gap: space.md }}>
      <Label>Factures</Label>
      <View style={{ gap: space.sm }}>
        {data.map((inv) => (
          <View
            key={inv.id}
            style={{
              flexDirection: 'row',
              justifyContent: 'space-between',
              alignItems: 'center',
              paddingVertical: space.xs,
              borderBottomWidth: 1,
              borderBottomColor: theme.border,
            }}
          >
            <View style={{ flex: 1 }}>
              <Text style={{ color: theme.text, fontSize: type.caption, fontWeight: weight.bold }}>
                {inv.number}
              </Text>
              <Text style={{ color: theme.textMuted, fontSize: 11 }}>
                {fmtDate(inv.periodStart)} – {fmtDate(inv.periodEnd)}
              </Text>
            </View>
            <View style={{ alignItems: 'flex-end', gap: 2 }}>
              <Text
                style={{
                  color: theme.text,
                  fontSize: type.caption,
                  fontWeight: weight.bold,
                }}
              >
                {fmtXof(inv.totalXof)}
              </Text>
              <Text
                style={{
                  color: STATUS_COLOR[inv.status],
                  fontSize: 11,
                  fontWeight: weight.bold,
                }}
              >
                {STATUS_LABEL[inv.status]}
              </Text>
            </View>
          </View>
        ))}
      </View>
    </Card>
  );
}

export default function AccountingScreen() {
  const navHeight = useBottomNavHeight();
  const qc = useQueryClient();
  const [refreshing, setRefreshing] = useState(false);

  const period = useQuery({
    queryKey: ['accounting', 'revenue-period'],
    queryFn: () => api.accounting.revenueByPeriod(12),
  });

  const byRouter = useQuery({
    queryKey: ['accounting', 'revenue-router'],
    queryFn: () => api.accounting.revenueByRouter(),
  });

  const invoices = useQuery({
    queryKey: ['accounting', 'invoices'],
    queryFn: () => api.accounting.invoices(),
  });

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await qc.invalidateQueries({ queryKey: ['accounting'] });
    setRefreshing(false);
  }, [qc]);

  const totalRevenue = period.data?.reduce((s, d) => s + d.totalXof, 0) ?? 0;
  const totalTx = period.data?.reduce((s, d) => s + d.transactionCount, 0) ?? 0;
  const currentMonth = period.data?.at(-1);

  const loading = period.isLoading || byRouter.isLoading || invoices.isLoading;
  const error = period.error || byRouter.error || invoices.error;

  return (
    <View style={{ flex: 1, backgroundColor: theme.bg }}>
      <AppHeader title="Comptabilité" back />
      <ScrollView
        contentContainerStyle={{
          gap: space.lg,
          padding: space.lg,
          paddingBottom: navHeight,
        }}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={theme.text} />
        }
      >
        <View>
          <Title>Comptabilité</Title>
          <Subtitle>Suivi financier de votre activité WiFi.</Subtitle>
        </View>

        {error ? (
          <ErrorState message="Impossible de charger les données comptables." onRetry={onRefresh} />
        ) : loading ? (
          <View style={{ gap: space.md }}>
            <Skeleton height={80} />
            <Skeleton height={160} />
            <Skeleton height={120} />
          </View>
        ) : (
          <>
            <Row style={{ gap: space.sm }}>
              <Card style={{ flex: 1, alignItems: 'center', gap: 4 }}>
                <Ionicons name="cash-outline" size={20} color={theme.success} />
                <Text
                  style={{
                    color: theme.success,
                    fontSize: type.bodyLg,
                    fontWeight: weight.bold,
                  }}
                >
                  {fmtXof(totalRevenue)}
                </Text>
                <Text style={{ color: theme.textMuted, fontSize: 11 }}>CA 12 mois</Text>
              </Card>
              <Card style={{ flex: 1, alignItems: 'center', gap: 4 }}>
                <Ionicons name="receipt-outline" size={20} color={theme.primary} />
                <Text
                  style={{
                    color: theme.text,
                    fontSize: type.bodyLg,
                    fontWeight: weight.bold,
                  }}
                >
                  {totalTx}
                </Text>
                <Text style={{ color: theme.textMuted, fontSize: 11 }}>Transactions</Text>
              </Card>
              {currentMonth ? (
                <Card style={{ flex: 1, alignItems: 'center', gap: 4 }}>
                  <Ionicons name="calendar-outline" size={20} color={theme.warning} />
                  <Text
                    style={{
                      color: theme.text,
                      fontSize: type.bodyLg,
                      fontWeight: weight.bold,
                    }}
                  >
                    {fmtXof(currentMonth.totalXof)}
                  </Text>
                  <Text style={{ color: theme.textMuted, fontSize: 11 }}>Ce mois</Text>
                </Card>
              ) : null}
            </Row>

            <RevenueChart data={period.data ?? []} />
            <RouterBreakdown data={byRouter.data ?? []} />
            <InvoiceList data={invoices.data?.items ?? []} />
          </>
        )}
      </ScrollView>
      <BottomNav />
    </View>
  );
}
