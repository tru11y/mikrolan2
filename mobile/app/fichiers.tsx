export { ScreenErrorBoundary as ErrorBoundary } from '@/src/components/ScreenErrorBoundary';
import { useState } from 'react';
import { ScrollView, Share, Text, View } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  api,
  extractErrorMessage,
  type VoucherBatch,
  type VoucherItem,
} from '@/src/lib/api';
import { printTickets, printTicketsDirect } from '@/src/lib/ticketsPdf';
import { reportSilent } from '@/src/lib/report';
import { TicketCard } from '@/src/components/TicketCard';
import { Badge, Banner, Button, ConfirmDialog, Empty, Press, Subtitle, Title,
  withAlpha,
} from '@/src/components/ui';
import { useTheme } from '@/src/providers/theme-provider';
import { BottomNav, useBottomNavHeight } from '@/src/components/BottomNav';
import { AppHeader } from '@/src/components/AppHeader';

const STATUS_TONE: Record<
  VoucherItem['status'],
  'muted' | 'success' | 'danger' | 'warning' | 'primary'
> = {
  GENERATED: 'primary',
  ACTIVE: 'success',
  USED: 'muted',
  EXPIRED: 'warning',
  REVOKED: 'danger',
};

function fmtDuration(min: number): string {
  if (min % 1440 === 0) return `${min / 1440}j`;
  if (min % 60 === 0) return `${min / 60}h`;
  return `${min}min`;
}

function fmtDateFull(iso: string): string {
  const d = new Date(iso);
  const dd = String(d.getDate()).padStart(2, '0');
  const MM = String(d.getMonth() + 1).padStart(2, '0');
  const yyyy = d.getFullYear();
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  const ss = String(d.getSeconds()).padStart(2, '0');
  return `${dd}/${MM}/${yyyy} ${hh}:${mm}:${ss}`;
}

type BatchAction = { batchId: string; kind: 'download' | 'print' | 'share' } | null;

function ActionButton({
  icon,
  label,
  color,
  onPress,
  disabled,
  loading,
}: {
  icon: string;
  label: string;
  color: string;
  onPress: () => void;
  disabled?: boolean;
  loading?: boolean;
}) {
  const theme = useTheme();
  return (
    <Press
      accessibilityLabel={label}
      onPress={onPress}
      disabled={disabled}
      style={{
        flex: 1,
        alignItems: 'center',
        gap: 4,
        paddingVertical: 10,
        borderRadius: 10,
        backgroundColor: withAlpha(color, 0.08),
        opacity: loading ? 0.5 : 1,
      }}
    >
      <Ionicons name={icon as any} size={18} color={color} />
      <Text style={{ color, fontSize: 11, fontWeight: '600' }}>{label}</Text>
    </Press>
  );
}

export default function FichiersScreen() {
  const theme = useTheme();
  const { t } = useTranslation();
  const { routerId } = useLocalSearchParams<{ routerId: string }>();
  const qc = useQueryClient();
  const navHeight = useBottomNavHeight();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<BatchAction>(null);
  const [confirmVoucher, setConfirmVoucher] = useState<VoucherItem | null>(null);
  const [confirmBatch, setConfirmBatch] = useState<VoucherBatch | null>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);

  const routerQuery = useQuery({
    queryKey: ['router', routerId],
    queryFn: () => api.routers.get(routerId),
    enabled: Boolean(routerId),
  });
  const plansQuery = useQuery({
    queryKey: ['plans', routerId],
    queryFn: () => api.plans.list(routerId),
    enabled: Boolean(routerId),
  });
  const batchesQuery = useQuery({
    queryKey: ['batches', routerId],
    queryFn: () => api.routers.listBatches(routerId),
    enabled: Boolean(routerId),
  });
  const vouchersQuery = useQuery({
    queryKey: ['vouchers', routerId],
    queryFn: () => api.routers.listVouchers(routerId),
    enabled: Boolean(routerId),
  });

  function buildPdfOpts(batch: VoucherBatch, codes: { code: string }[]) {
    const plan = plansQuery.data?.find((p) => p.id === batch.planId);
    const r = routerQuery.data;
    return {
      routerName: r?.alias || r?.identity || 'WiFi',
      planName: batch.plan.name,
      durationMinutes: plan?.durationMinutes ?? 0,
      priceXof: batch.plan.priceXof,
      tickets: codes,
      template: r?.ticketTemplate,
      batchSeq: batch.seq,
      batchDate: batch.createdAt,
    };
  }

  async function batchAction(batch: VoucherBatch, kind: 'download' | 'print' | 'share') {
    setError(null);
    setBusy({ batchId: batch.id, kind });
    try {
      const codes = await api.routers.listVouchers(routerId, {
        batchId: batch.id,
      });
      if (!codes.length) {
        setError('Ce lot ne contient aucun code.');
        return;
      }
      const opts = buildPdfOpts(batch, codes.map((v) => ({ code: v.code })));
      if (kind === 'share') {
        const text = codes.map((v) => v.code).join('\n');
        await Share.share({
          message: `Lot #${batch.seq} — ${batch.generated} tickets\n\n${text}`,
        });
      } else if (kind === 'download') {
        await printTickets(opts);
      } else {
        await printTicketsDirect(opts);
      }
    } catch (e) {
      reportSilent('fichiers.batch-action', e, { routerId, batchId: batch.id, kind });
      setError(extractErrorMessage(e));
    } finally {
      setBusy(null);
    }
  }

  async function shareCodes(codes: VoucherItem[]) {
    try {
      const text = codes.map((v) => v.code).join('\n');
      await Share.share({ message: `${t('fichiers.wifiCodes')}\n${text}` });
    } catch (e) {
      reportSilent('fichiers.share', e, { routerId });
      setError(extractErrorMessage(e));
    }
  }

  async function revoke(id: string) {
    try {
      await api.routers.revokeVoucher(routerId, id);
      await qc.invalidateQueries({ queryKey: ['vouchers', routerId] });
    } catch (e) {
      reportSilent('fichiers.revoke', e, { routerId, voucherId: id });
      setError(extractErrorMessage(e));
    }
  }

  async function deleteVoucherConfirmed() {
    if (!confirmVoucher) return;
    setDeleteBusy(true);
    setError(null);
    try {
      await api.routers.deleteVoucher(routerId, confirmVoucher.id);
      await qc.invalidateQueries({ queryKey: ['vouchers', routerId] });
      setConfirmVoucher(null);
    } catch (e) {
      reportSilent('fichiers.delete-voucher', e, { routerId, voucherId: confirmVoucher.id });
      setError(extractErrorMessage(e));
    } finally {
      setDeleteBusy(false);
    }
  }

  async function deleteBatchConfirmed() {
    if (!confirmBatch) return;
    setDeleteBusy(true);
    setError(null);
    try {
      await api.routers.deleteBatch(routerId, confirmBatch.id);
      await qc.invalidateQueries({ queryKey: ['batches', routerId] });
      await qc.invalidateQueries({ queryKey: ['vouchers', routerId] });
      setConfirmBatch(null);
    } catch (e) {
      reportSilent('fichiers.delete-batch', e, { routerId, batchId: confirmBatch.id });
      setError(extractErrorMessage(e));
    } finally {
      setDeleteBusy(false);
    }
  }

  const routerName = routerQuery.data?.alias || routerQuery.data?.identity || '';

  return (
    <View style={{ flex: 1, backgroundColor: theme.bg }}>
      <AppHeader title={t('fichiers.screenTitle')} back />
      <ScrollView contentContainerStyle={{ gap: 16, padding: 16, paddingBottom: navHeight }}>
        <View>
          <Title>{t('fichiers.titleFull')}</Title>
          <Subtitle>
            {t('fichiers.subtitle')}
          </Subtitle>
        </View>

        {error ? <Banner tone="danger">{error}</Banner> : null}

        <View style={{ gap: 12 }}>
          {!batchesQuery.data?.length ? (
            <Empty icon="folder-open-outline" text={t('fichiers.noBatch')} />
          ) : (
            batchesQuery.data.map((b) => {
              const isActive = busy?.batchId === b.id;
              return (
                <View
                  key={b.id}
                  style={{
                    backgroundColor: theme.surface,
                    borderRadius: 16,
                    padding: 16,
                    gap: 12,
                  }}
                >
                  {/* Header — Wallet style */}
                  <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 12 }}>
                    <View
                      style={{
                        width: 44,
                        height: 44,
                        borderRadius: 12,
                        backgroundColor: withAlpha(theme.primary, 0.12),
                        alignItems: 'center',
                        justifyContent: 'center',
                      }}
                    >
                      <Ionicons name="document-text" size={22} color={theme.primary} />
                    </View>
                    <View style={{ flex: 1, gap: 2 }}>
                      <Text style={{ color: theme.text, fontSize: 16, fontWeight: '700' }}>
                        Lot #{b.seq}
                      </Text>
                      {routerName ? (
                        <Text style={{ color: theme.textMuted, fontSize: 13 }}>
                          {routerName}
                        </Text>
                      ) : null}
                      <Text style={{ color: theme.textMuted, fontSize: 13 }}>
                        {b.generated} tickets
                      </Text>
                      <Text style={{ color: theme.textMuted, fontSize: 12 }}>
                        {fmtDateFull(b.createdAt)}
                      </Text>
                    </View>
                    <Press
                      accessibilityLabel={t('fichiers.deleteBatch')}
                      onPress={() => setConfirmBatch(b)}
                      disabled={busy !== null}
                      style={{
                        width: 34,
                        height: 34,
                        borderRadius: 8,
                        backgroundColor: withAlpha(theme.danger, 0.08),
                        alignItems: 'center',
                        justifyContent: 'center',
                      }}
                    >
                      <Ionicons name="trash-outline" size={15} color={theme.danger} />
                    </Press>
                  </View>

                  {/* Actions row */}
                  <View style={{ flexDirection: 'row', gap: 8 }}>
                    <ActionButton
                      icon="share-outline"
                      label={t('common.share')}
                      color={theme.primary}
                      onPress={() => batchAction(b, 'share')}
                      disabled={isActive}
                      loading={isActive && busy?.kind === 'share'}
                    />
                    <ActionButton
                      icon="print-outline"
                      label={t('common.print')}
                      color={theme.primaryMuted}
                      onPress={() => batchAction(b, 'print')}
                      disabled={isActive}
                      loading={isActive && busy?.kind === 'print'}
                    />
                    <ActionButton
                      icon="download-outline"
                      label={t('common.download')}
                      color={theme.primaryMuted}
                      onPress={() => batchAction(b, 'download')}
                      disabled={isActive}
                      loading={isActive && busy?.kind === 'download'}
                    />
                  </View>
                </View>
              );
            })
          )}
        </View>

        <Text style={{ color: theme.text, fontSize: 14, fontWeight: '700' }}>
          {t('fichiers.existingCodes')}
        </Text>
        {vouchersQuery.isLoading ? (
          <Text style={{ color: theme.textMuted, fontSize: 13 }}>Chargement…</Text>
        ) : !vouchersQuery.data?.length ? (
          <Empty icon="key-outline" text={t('fichiers.noCode')} />
        ) : (
          <View style={{ gap: 12 }}>
            {vouchersQuery.data.map((v) => {
              const plan = plansQuery.data?.find((p) => p.id === v.planId);
              return (
                <View key={v.id} style={{ gap: 8 }}>
                  <TicketCard
                    code={v.code}
                    planName={plan?.name ?? ''}
                    priceXof={plan?.priceXof ?? 0}
                    durationLabel={plan ? fmtDuration(plan.durationMinutes) : ''}
                    compact
                  />
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
                    <Badge label={v.status} tone={STATUS_TONE[v.status]} />
                    <View style={{ flex: 1 }}>
                      <Button
                        title={t('common.share')}
                        variant="ghost"
                        onPress={() => shareCodes([v])}
                      />
                    </View>
                    {v.status !== 'REVOKED' ? (
                      <View style={{ flex: 1 }}>
                        <Button
                          title={t('common.revoke')}
                          variant="danger"
                          onPress={() => revoke(v.id)}
                        />
                      </View>
                    ) : null}
                    <View style={{ flex: 1 }}>
                      <Button
                        title={t('common.delete')}
                        variant="danger"
                        onPress={() => setConfirmVoucher(v)}
                      />
                    </View>
                  </View>
                </View>
              );
            })}
          </View>
        )}
      </ScrollView>
      <BottomNav active="fichiers" />

      <ConfirmDialog
        visible={confirmVoucher !== null}
        icon="trash-outline"
        title={t('fichiers.deleteTicketTitle')}
        message={t('fichiers.deleteTicketMessage', { code: confirmVoucher?.code ?? '' })}
        confirmLabel={t('common.delete')}
        tone="danger"
        busy={deleteBusy}
        onConfirm={deleteVoucherConfirmed}
        onCancel={() => setConfirmVoucher(null)}
      />

      <ConfirmDialog
        visible={confirmBatch !== null}
        icon="trash-outline"
        title={t('fichiers.deleteBatchTitle')}
        message={t('fichiers.deleteBatchMessage', { count: confirmBatch?.generated ?? 0 })}
        confirmLabel={t('common.delete')}
        tone="danger"
        busy={deleteBusy}
        onConfirm={deleteBatchConfirmed}
        onCancel={() => setConfirmBatch(null)}
      />
    </View>
  );
}
