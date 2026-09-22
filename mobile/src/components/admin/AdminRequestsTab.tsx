import { useState } from 'react';
import { Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, type AdminInvoice } from '@/src/lib/api';
import { describeError } from '@/src/lib/errors';
import { formatXof } from '@/src/config/tiers';
import { useSseLive } from '@/src/providers/live-events-provider';
import {
  Button,
  Card,
  ConfirmDialog,
  Empty,
  ErrorState,
  FadeIn,
  radius,
  Row,
  SkeletonCard,
  space,
  type,
  useToast,
} from '@/src/components/ui';
import { useTheme } from '@/src/providers/theme-provider';
import { shortDate } from '@/src/lib/format';

export function AdminRequestsTab() {
  const theme = useTheme();
  const { t } = useTranslation();
  const qc = useQueryClient();
  const toast = useToast();
  const sseLive = useSseLive();
  const [confirming, setConfirming] = useState<AdminInvoice | null>(null);

  const query = useQuery({
    queryKey: ['admin', 'invoices', 'PENDING'],
    queryFn: () => api.admin.invoices({ status: 'PENDING', limit: 50 }),
    refetchInterval: sseLive ? false : 30_000,
    placeholderData: keepPreviousData,
  });

  const activate = useMutation({
    mutationFn: (invoice: AdminInvoice) =>
      api.subscriptions.activate(invoice.tenantId, invoice.periodDays),
    onSuccess: async () => {
      toast.success(t('admin.subscriptionActivated'));
      setConfirming(null);
      await Promise.all([
        qc.invalidateQueries({ queryKey: ['admin', 'invoices'] }),
        qc.invalidateQueries({ queryKey: ['admin', 'metrics'] }),
        qc.invalidateQueries({ queryKey: ['admin', 'tenants'] }),
      ]);
    },
    onError: (e) => toast.error(describeError(e).message),
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

            <Button
              title={t('admin.validatePayment', { days: inv.periodDays })}
              onPress={() => setConfirming(inv)}
              loading={activate.isPending && confirming?.id === inv.id}
            />
          </Card>
        </FadeIn>
      ))}

      <ConfirmDialog
        visible={confirming !== null}
        icon="cash-outline"
        tone="primary"
        title={t('admin.confirmCollection')}
        message={
          confirming
            ? t('admin.confirmCollectionMessage', { amount: formatXof(confirming.amount), tenant: confirming.tenantName, days: confirming.periodDays })
            : ''
        }
        confirmLabel={t('admin.activateButton')}
        busy={activate.isPending}
        onConfirm={() => confirming && activate.mutate(confirming)}
        onCancel={() => setConfirming(null)}
      />
    </View>
  );
}
