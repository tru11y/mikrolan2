import { memo } from 'react';
import { Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { api } from '@/src/lib/api';
import { describeError } from '@/src/lib/errors';
import { formatXof } from '@/src/config/tiers';
import { useSseLive } from '@/src/providers/live-events-provider';
import {
  Card,
  ErrorState,
  FadeIn,
  Press,
  radius,
  Row,
  SectionTitle,
  Skeleton,
  SkeletonCard,
  space,
  Stat,
  type,
  withAlpha,
} from '@/src/components/ui';
import { useTheme as useAppTheme } from '@/src/providers/theme-provider';
import { type Tab, tabSetterRef } from './shared';

const AlertBanner = memo(function AlertBanner({
  icon,
  color,
  text,
  onPress,
}: {
  icon: string;
  color: string;
  text: string;
  onPress?: () => void;
}) {
  const theme = useAppTheme();
  const Wrapper = onPress ? Press : View;
  return (
    <Wrapper
      onPress={onPress}
      style={{
        flexDirection: 'row',
        gap: space.sm,
        alignItems: 'center',
        backgroundColor: withAlpha(color, 0.1),
        borderRadius: radius.md,
        padding: space.md,
        borderLeftWidth: 3,
        borderLeftColor: color,
      }}
    >
      <Ionicons name={icon as any} size={18} color={color} />
      <Text style={{ color: theme.text, fontSize: type.body, flex: 1, fontWeight: '600' }}>
        {text}
      </Text>
      {onPress ? <Ionicons name="chevron-forward" size={16} color={theme.textMuted} /> : null}
    </Wrapper>
  );
});

const QuickAction = memo(function QuickAction({
  icon,
  label,
  value,
  tone,
  onPress,
}: {
  icon: string;
  label: string;
  value: string;
  tone?: string;
  onPress: () => void;
}) {
  const theme = useAppTheme();
  const toneColor = tone === 'danger' ? theme.danger : tone === 'gold' ? theme.gold : tone === 'success' ? theme.success : theme.primary;
  return (
    <Press
      onPress={onPress}
      style={{
        flex: 1,
        backgroundColor: theme.surface,
        borderRadius: radius.lg,
        padding: space.md,
        alignItems: 'center',
        gap: 4,
      }}
    >
      <View
        style={{
          width: 36,
          height: 36,
          borderRadius: 18,
          backgroundColor: withAlpha(toneColor, 0.12),
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <Ionicons name={icon as any} size={18} color={toneColor} />
      </View>
      <Text style={{ color: theme.text, fontSize: type.bodyLg, fontWeight: '800' }}>{value}</Text>
      <Text style={{ color: theme.textMuted, fontSize: type.micro - 1, textAlign: 'center' }}>{label}</Text>
    </Press>
  );
});

const RevenueHistoryChart = memo(function RevenueHistoryChart() {
  const theme = useAppTheme();
  const { t } = useTranslation();
  const query = useQuery({
    queryKey: ['admin-revenue-history'],
    queryFn: () => api.admin.revenueHistory(6),
  });

  if (query.isLoading) return <SkeletonCard />;
  if (query.isError || !query.data?.length) return null;

  const data = query.data;
  const maxTotal = Math.max(...data.map((d) => d.total), 1);

  return (
    <Card>
      <SectionTitle>{t('admin.revenueHistory')}</SectionTitle>
      <View style={{ gap: space.sm, marginTop: space.md }}>
        {data.map((d) => (
          <View key={d.month} style={{ gap: 2 }}>
            <Row style={{ justifyContent: 'space-between' }}>
              <Text style={{ color: theme.textMuted, fontSize: type.micro }}>{d.month}</Text>
              <Text style={{ color: theme.text, fontSize: type.micro, fontWeight: '600' }}>
                {formatXof(d.total)} ({d.count})
              </Text>
            </Row>
            <View style={{ height: 6, backgroundColor: theme.surface, borderRadius: 3 }}>
              <View
                style={{
                  height: 6,
                  width: `${(d.total / maxTotal) * 100}%`,
                  backgroundColor: theme.primary,
                  borderRadius: 3,
                }}
              />
            </View>
          </View>
        ))}
      </View>
    </Card>
  );
});

export function AdminOverviewTab() {
  const theme = useAppTheme();
  const sseLive = useSseLive();
  const query = useQuery({
    queryKey: ['admin', 'metrics'],
    queryFn: api.admin.metrics,
    refetchInterval: sseLive ? false : 60_000,
    placeholderData: keepPreviousData,
  });

  const setParentTab = tabSetterRef.current;

  if (query.isLoading) {
    return (
      <View style={{ gap: space.md }}>
        <Row style={{ gap: space.md }}>
          <Skeleton height={92} radius={radius.lg} />
          <Skeleton height={92} radius={radius.lg} />
        </Row>
        <SkeletonCard />
      </View>
    );
  }
  if (query.isError || !query.data) {
    return (
      <ErrorState
        message={describeError(query.error).message}
        onRetry={() => query.refetch()}
        retrying={query.isFetching}
      />
    );
  }

  const m = query.data;
  const alerts: { icon: string; color: string; text: string; tab?: Tab }[] = [];

  if (m.routers.offline > 0) {
    alerts.push({
      icon: 'warning-outline',
      color: theme.danger,
      text: `${m.routers.offline} routeur${m.routers.offline > 1 ? 's' : ''} hors ligne`,
      tab: 'fleet',
    });
  }
  if (m.routers.degraded > 0) {
    alerts.push({
      icon: 'alert-circle-outline',
      color: theme.gold,
      text: `${m.routers.degraded} routeur${m.routers.degraded > 1 ? 's' : ''} dégradé${m.routers.degraded > 1 ? 's' : ''}`,
      tab: 'fleet',
    });
  }
  if (m.pendingInvoices > 0) {
    alerts.push({
      icon: 'mail-unread-outline',
      color: theme.primary,
      text: `${m.pendingInvoices} paiement${m.pendingInvoices > 1 ? 's' : ''} en attente`,
      tab: 'demandes',
    });
  }
  if (m.support.overdue > 0) {
    alerts.push({
      icon: 'time-outline',
      color: theme.danger,
      text: `${m.support.overdue} ticket${m.support.overdue > 1 ? 's' : ''} SAV en retard`,
      tab: 'tickets',
    });
  }
  if (m.trialsExpiringIn7Days > 0) {
    alerts.push({
      icon: 'hourglass-outline',
      color: theme.gold,
      text: `${m.trialsExpiringIn7Days} essai${m.trialsExpiringIn7Days > 1 ? 's' : ''} expire${m.trialsExpiringIn7Days > 1 ? 'nt' : ''} sous 7j`,
      tab: 'comptes',
    });
  }
  if (m.revenue.untieredActive > 0) {
    alerts.push({
      icon: 'alert-circle-outline',
      color: theme.gold,
      text: `${m.revenue.untieredActive} abonnement${m.revenue.untieredActive > 1 ? 's' : ''} sans formule`,
      tab: 'comptes',
    });
  }

  return (
    <View style={{ gap: space.lg }}>
      {/* Alertes critiques */}
      {alerts.length > 0 ? (
        <FadeIn>
          <View style={{ gap: space.sm }}>
            {alerts.map((a, i) => (
              <AlertBanner
                key={i}
                icon={a.icon}
                color={a.color}
                text={a.text}
                onPress={a.tab && setParentTab ? () => setParentTab(a.tab!) : undefined}
              />
            ))}
          </View>
        </FadeIn>
      ) : (
        <FadeIn>
          <AlertBanner icon="checkmark-circle-outline" color={theme.success} text="Aucune alerte — tout est opérationnel" />
        </FadeIn>
      )}

      {/* KPIs principaux */}
      <FadeIn delay={60}>
        <Row style={{ gap: space.sm, alignItems: 'stretch' }}>
          <Stat
            icon="cash-outline"
            tone="gold"
            value={formatXof(m.revenue.mrrXof)}
            label="MRR"
          />
          <Stat
            icon="ribbon-outline"
            tone="success"
            value={String(m.tenants.pro)}
            label="Clients PRO"
          />
        </Row>
      </FadeIn>

      {/* Accès rapides */}
      <FadeIn delay={120}>
        <SectionTitle>Accès rapides</SectionTitle>
        <Row style={{ gap: space.sm, alignItems: 'stretch', marginTop: space.sm }}>
          <QuickAction
            icon="hardware-chip-outline"
            label="Routeurs"
            value={`${m.routers.online}/${m.routers.total}`}
            tone={m.routers.offline > 0 ? 'danger' : 'success'}
            onPress={() => setParentTab?.('fleet')}
          />
          <QuickAction
            icon="mail-unread-outline"
            label="Paiements"
            value={String(m.pendingInvoices)}
            tone={m.pendingInvoices > 0 ? 'gold' : undefined}
            onPress={() => setParentTab?.('demandes')}
          />
          <QuickAction
            icon="chatbubbles-outline"
            label="SAV"
            value={String(m.support.open)}
            tone={m.support.overdue > 0 ? 'danger' : undefined}
            onPress={() => setParentTab?.('tickets')}
          />
        </Row>
      </FadeIn>

      {/* Opérations */}
      <FadeIn delay={180}>
        <Card>
          <SectionTitle>Opérations (30j)</SectionTitle>
          <Row>
            <Text style={{ color: theme.textMuted, fontSize: type.body }}>Tickets générés</Text>
            <Text style={{ color: theme.text, fontSize: type.body, fontWeight: '700' }}>
              {m.vouchers30d.generated.toLocaleString('fr-FR')}
            </Text>
          </Row>
          <Row>
            <Text style={{ color: theme.textMuted, fontSize: type.body }}>Tickets utilisés</Text>
            <Text style={{ color: theme.text, fontSize: type.body, fontWeight: '700' }}>
              {m.vouchers30d.activated.toLocaleString('fr-FR')}
            </Text>
          </Row>
          <Row>
            <Text style={{ color: theme.textMuted, fontSize: type.body }}>Sessions actives</Text>
            <Text style={{ color: theme.text, fontSize: type.body, fontWeight: '700' }}>
              {m.sessions?.active ?? 0}
            </Text>
          </Row>
          <Row>
            <Text style={{ color: theme.textMuted, fontSize: type.body }}>Comptes</Text>
            <Text style={{ color: theme.text, fontSize: type.body, fontWeight: '700' }}>
              {m.tenants.total} ({m.tenants.trialing} essais)
            </Text>
          </Row>
        </Card>
      </FadeIn>

      <FadeIn delay={240}>
        <RevenueHistoryChart />
      </FadeIn>
    </View>
  );
}
