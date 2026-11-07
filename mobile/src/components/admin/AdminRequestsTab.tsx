import { Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { api } from '@/src/lib/api';
import { invoicePaymentKey } from '@/src/lib/invoicePayment';
import { describeError } from '@/src/lib/errors';
import { formatXof } from '@/src/config/tiers';
import { useSseLive } from '@/src/providers/live-events-provider';
import {
  Badge,
  Card,
  Empty,
  ErrorState,
  FadeIn,
  radius,
  Row,
  SkeletonCard,
  space,
  type,
} from '@/src/components/ui';
import { useTheme } from '@/src/providers/theme-provider';
import { shortDate } from '@/src/lib/format';

export function AdminRequestsTab() {
  const theme = useTheme();
  const { t } = useTranslation();
  const sseLive = useSseLive();
  const query = useQuery({
    queryKey: ['admin', 'invoices', 'PENDING'],
    queryFn: () => api.admin.invoices({ status: 'PENDING', limit: 50 }),
    refetchInterval: sseLive ? false : 30_000,
    placeholderData: keepPreviousData,
  });

  if (query.isLoading) return <SkeletonCard lines={3} />;
  if (query.isError) {
    return (
      <ErrorState
        message={describeError(query.error).message}
        onRetry={() => query.refetch()}
        retrying={query.isFetching}
      />
    );
  }

  const items = query.data?.items ?? [];
  if (!items.length) {
    return (
      <Empty
        icon="checkmark-done-outline"
        text={t('admin.noRequests')}
      />
    );
  }

  return (
    <View style={{ gap: space.md }}>
      <Text style={{ color: theme.textMuted, fontSize: type.caption }}>{t('adminPayments.autoActivationInfo')}</Text>
      {items.map((inv, i) => (
        <FadeIn key={inv.id} delay={i * 50}>
          <Card>
            <Row style={{ alignItems: 'flex-start' }}>
              <View style={{ flex: 1, paddingRight: space.md }}>
                <Text
                  style={{ color: theme.text, fontSize: type.bodyLg, fontWeight: '700' }}
                >
                  {inv.tenantName}
                </Text>
                <Text style={{ color: theme.textMuted, fontSize: type.micro }}>
                  {t('admin.requestedOn', { date: shortDate(inv.createdAt) })}
                </Text>
              </View>
              <View style={{ alignItems: 'flex-end' }}>
                <Text
                  style={{ color: theme.gold, fontSize: type.bodyLg, fontWeight: '800' }}
                >
                  {formatXof(inv.amount)}
                </Text>
                <Text style={{ color: theme.textMuted, fontSize: type.micro }}>
                  {inv.tierName ?? '—'} ·{' '}
                  {inv.billingPeriod === 'ANNUAL' ? t('admin.annualBilling') : t('admin.monthlyBilling')}
                </Text>
              </View>
            </Row>

            {/* Le résumé du conseiller : c'est ce qui dit pourquoi ce client
                demande cette formule, et ce qu'il faut lui répondre. */}
            {inv.note ? (
              <Row
                style={{
                  gap: space.sm,
                  alignItems: 'flex-start',
                  backgroundColor: theme.surfaceAlt,
                  borderRadius: radius.sm,
                  padding: space.md,
                }}
              >
                <Ionicons name="chatbubble-outline" size={14} color={theme.textMuted} />
                <Text
                  style={{ color: theme.textMuted, fontSize: type.micro, flex: 1, lineHeight: 16 }}
                >
                  {inv.note}
                </Text>
              </Row>
            ) : null}

            {/* Lecture seule : l'activation est automatique, après confirmation du webhook SasPay. */}
            <Row style={{ gap: space.sm, alignItems: 'center', flexWrap: 'wrap' }}>
              <Badge label={inv.status} tone={inv.status === 'PAID' ? 'success' : inv.status === 'PENDING' ? 'gold' : 'danger'} />
              {inv.provider ? <Badge label={inv.provider === 'SASPAY' ? 'SasPay' : t('adminPayments.manualBadge')} /> : null}
            </Row>
            <Text style={{ color: theme.textMuted, fontSize: type.caption }}>
              {t(`adminPayments.${invoicePaymentKey(inv.provider, inv.status)}`, { defaultValue: inv.status })}
            </Text>
          </Card>
        </FadeIn>
      ))}
    </View>
  );
}
