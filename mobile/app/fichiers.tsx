export { ScreenErrorBoundary as ErrorBoundary } from '@/src/components/ScreenErrorBoundary';
import { useState } from 'react';
import { FlatList, Share, Text, View } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  api,
  extractErrorMessage,
  type BatchDeletionPreview,
  type BulkDeletionResult,
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
import { lotState, plural } from '@/src/lib/lotState';

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

function buildDeletionMessage(
  t: (key: string, opts?: Record<string, unknown>) => string,
  eligibleKey: string,
  preview: { eligible: number; keptForHistory: number; connectedNow: number },
): string {
  const lines = [t(eligibleKey, { count: preview.eligible })];
  if (preview.keptForHistory > 0) {
    lines.push(t('fichiers.protectedHistoryLine', { count: preview.keptForHistory }));
  }
  if (preview.connectedNow > 0) {
    lines.push(t('fichiers.protectedConnectedLine', { count: preview.connectedNow }));
  }
  return lines.join('\n\n');
}

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

function LotStatus({
  batch,
  t,
}: {
  batch: VoucherBatch;
  t: (key: string, opts?: Record<string, unknown>) => string;
}) {
  const theme = useTheme();
  const { state, available, missing } = lotState(batch);
  const line = { color: theme.textMuted, fontSize: 13 } as const;
  if (state === 'generating') return <Text style={line}>{t('fichiers.lotGenerating')}</Text>;
  if (state === 'empty') return <Text style={line}>{t('fichiers.lotEmpty')}</Text>;
  if (state === 'completed') {
    return (
      <Text style={{ ...line, color: theme.success, fontWeight: '700' }}>
        {plural(t, 'fichiers.lotAvailable', available)}
      </Text>
    );
  }
  if (state === 'partial') {
    return (
      <View style={{ gap: 2 }}>
        <Text style={{ ...line, color: theme.warning, fontWeight: '700' }}>{t('fichiers.lotPartialTitle')}</Text>
        <Text style={line}>
          {plural(t, 'fichiers.lotPartialDetail', available, { requested: batch.quantity })}
        </Text>
        <Text style={line}>{plural(t, 'fichiers.lotMissing', missing)}</Text>
      </View>
    );
  }
  return (
    <View style={{ gap: 2 }}>
      <Text style={{ ...line, color: theme.danger, fontWeight: '700' }}>{t('fichiers.lotFailedTitle')}</Text>
      <Text style={line}>{t('fichiers.lotFailedDetail', { requested: batch.quantity })}</Text>
      <Text style={line}>{t('fichiers.lotFailedNotReady')}</Text>
      <Text style={line}>{t('fichiers.lotFailedReason')}</Text>
    </View>
  );
}

// Tickets montés à la fois : chaque TicketCard coûte ~25 vues + un QR SVG (~1 Mo natif).
const VOUCHERS_PAGE = 20;

function VoucherSeparator() {
  return <View style={{ height: 12 }} />;
}

export default function FichiersScreen() {
  const theme = useTheme();
  const { t } = useTranslation();
  const { routerId } = useLocalSearchParams<{ routerId: string }>();
  const qc = useQueryClient();
  const navHeight = useBottomNavHeight();
  const [error, setError] = useState<string | null>(null);
  const [shownCount, setShownCount] = useState(VOUCHERS_PAGE);
  const [busy, setBusy] = useState<BatchAction>(null);
  const [confirmVoucher, setConfirmVoucher] = useState<VoucherItem | null>(null);
  const [confirmBatch, setConfirmBatch] = useState<VoucherBatch | null>(null);
  const [batchPreview, setBatchPreview] = useState<BatchDeletionPreview | null>(null);
  const [batchPreviewLoading, setBatchPreviewLoading] = useState(false);
  const [confirmCleanup, setConfirmCleanup] = useState(false);
  const [cleanupPreview, setCleanupPreview] = useState<Omit<BatchDeletionPreview, 'batchId'> | null>(null);
  const [cleanupPreviewLoading, setCleanupPreviewLoading] = useState(false);
  const [cleanupBusy, setCleanupBusy] = useState(false);
  const [deleteResult, setDeleteResult] = useState<BulkDeletionResult | null>(null);
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
    queryKey: ['vouchers', routerId, 'all'],
    queryFn: () => api.routers.listVouchers(routerId, { includeUnprovisioned: true }),
    enabled: Boolean(routerId),
  });

  const vouchers = vouchersQuery.data ?? [];

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
      // Jamais de distribution d'un ticket non provisionné : le backend ne renvoie
      // que les provisionnés par défaut, et on re-filtre ici (strictement `true`).
      const codes = (await api.routers.listVouchers(routerId, { batchId: batch.id })).filter(
        (v) => v.provisioned === true,
      );
      if (!codes.length) {
        setError(t('fichiers.lotNoDistributable'));
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

  // Calcule combien de tickets seront réellement supprimés (inutilisés/
  // terminés) et combien seront protégés (clients connectés) AVANT que
  // l'opérateur confirme — jamais un simple compteur "généré".
  async function openDeleteBatch(b: VoucherBatch) {
    setConfirmBatch(b);
    setBatchPreview(null);
    setBatchPreviewLoading(true);
    try {
      const preview = await api.routers.previewBatchDeletion(routerId, b.id);
      setBatchPreview(preview);
    } catch (e) {
      reportSilent('fichiers.preview-batch', e, { routerId, batchId: b.id });
    } finally {
      setBatchPreviewLoading(false);
    }
  }

  async function deleteBatchConfirmed() {
    if (!confirmBatch) return;
    setDeleteBusy(true);
    setError(null);
    try {
      const result = await api.routers.deleteBatch(routerId, confirmBatch.id);
      await qc.invalidateQueries({ queryKey: ['batches', routerId] });
      await qc.invalidateQueries({ queryKey: ['vouchers', routerId] });
      setConfirmBatch(null);
      setBatchPreview(null);
      setDeleteResult(result);
    } catch (e) {
      reportSilent('fichiers.delete-batch', e, { routerId, batchId: confirmBatch.id });
      setError(extractErrorMessage(e));
    } finally {
      setDeleteBusy(false);
    }
  }

  async function openCleanup() {
    setConfirmCleanup(true);
    setCleanupPreview(null);
    setCleanupPreviewLoading(true);
    try {
      const preview = await api.routers.previewCleanup(routerId);
      setCleanupPreview(preview);
    } catch (e) {
      reportSilent('fichiers.preview-cleanup', e, { routerId });
    } finally {
      setCleanupPreviewLoading(false);
    }
  }

  async function cleanupConfirmed() {
    setCleanupBusy(true);
    setError(null);
    try {
      const result = await api.routers.cleanupVouchers(routerId);
      await qc.invalidateQueries({ queryKey: ['batches', routerId] });
      await qc.invalidateQueries({ queryKey: ['vouchers', routerId] });
      setConfirmCleanup(false);
      setCleanupPreview(null);
      setDeleteResult(result);
    } catch (e) {
      reportSilent('fichiers.cleanup', e, { routerId });
      setError(extractErrorMessage(e));
    } finally {
      setCleanupBusy(false);
    }
  }

  const routerName = routerQuery.data?.alias || routerQuery.data?.identity || '';

  return (
    <View style={{ flex: 1, backgroundColor: theme.bg }}>
      <AppHeader title={t('fichiers.screenTitle')} back />
      <FlatList
        data={vouchers.slice(0, shownCount)}
        keyExtractor={(v) => v.id}
        contentContainerStyle={{ padding: 16, paddingBottom: navHeight }}
        ItemSeparatorComponent={VoucherSeparator}
        // Liste virtualisée : seuls les tickets proches de l'écran sont montés
        // (chaque TicketCard = ~25 vues + un QR SVG ; 331 tickets montés d'un coup
        // = ~12 000 vues / ~800 Mo → OOM).
        initialNumToRender={6}
        maxToRenderPerBatch={6}
        windowSize={5}
        ListHeaderComponent={
          <View style={{ gap: 16, paddingBottom: 16 }}>
        <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 12 }}>
          <View style={{ flex: 1 }}>
            <Title>{t('fichiers.titleFull')}</Title>
            <Subtitle>
              {t('fichiers.subtitle')}
            </Subtitle>
          </View>
          <Press
            accessibilityLabel={t('fichiers.cleanupTitle')}
            onPress={openCleanup}
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              gap: 6,
              paddingHorizontal: 12,
              paddingVertical: 8,
              borderRadius: 10,
              backgroundColor: withAlpha(theme.danger, 0.08),
            }}
          >
            <Ionicons name="sparkles-outline" size={15} color={theme.danger} />
            <Text style={{ color: theme.danger, fontSize: 12, fontWeight: '700' }}>
              {t('fichiers.cleanupTitle')}
            </Text>
          </Press>
        </View>

        {error ? <Banner tone="danger">{error}</Banner> : null}

        {deleteResult ? (
          <Banner tone={deleteResult.routerCleanupFailed > 0 ? 'warning' : 'success'}>
            <View style={{ gap: 8 }}>
              <Text style={{ color: theme.text, fontWeight: '700' }}>
                {deleteResult.routerCleanupFailed > 0
                  ? t('fichiers.cleanupDoneWithNotes')
                  : t('fichiers.cleanupDone')}
              </Text>
              <Text style={{ color: theme.text }}>
                {t('fichiers.cleanupSummaryDeleted', { count: deleteResult.deleted })}
              </Text>
              {deleteResult.keptForHistory > 0 ? (
                <Text style={{ color: theme.text }}>
                  {t('fichiers.cleanupSummaryHistory', { count: deleteResult.keptForHistory })}
                </Text>
              ) : null}
              {deleteResult.connectedNow > 0 ? (
                <Text style={{ color: theme.text }}>
                  {t('fichiers.cleanupSummaryConnected', { count: deleteResult.connectedNow })}
                </Text>
              ) : null}
              {deleteResult.routerCleanupFailed > 0 ? (
                <Text style={{ color: theme.text }}>
                  {t('fichiers.cleanupSummaryFailed', { count: deleteResult.routerCleanupFailed })}
                </Text>
              ) : null}
              <Button
                title={t('fichiers.cleanupDoneButton')}
                variant="ghost"
                onPress={() => setDeleteResult(null)}
              />
            </View>
          </Banner>
        ) : null}

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
                      <LotStatus batch={b} t={t} />
                      <Text style={{ color: theme.textMuted, fontSize: 12 }}>
                        {fmtDateFull(b.createdAt)}
                      </Text>
                    </View>
                    <Press
                      accessibilityLabel={t('fichiers.deleteBatch')}
                      onPress={() => openDeleteBatch(b)}
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

                  {/* Distribution : uniquement si au moins un ticket provisionné */}
                  {lotState(b).available > 0 && lotState(b).state !== 'generating' ? (
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
                  ) : null}
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
            ) : null}
          </View>
        }
        ListFooterComponent={
          vouchers.length > shownCount ? (
            <View style={{ paddingTop: 16 }}>
              <Button
                title={t('fichiers.showMore', { count: vouchers.length - shownCount })}
                variant="ghost"
                onPress={() => setShownCount((c) => c + VOUCHERS_PAGE)}
              />
            </View>
          ) : null
        }
        renderItem={({ item: v }) => {
              const plan = plansQuery.data?.find((p) => p.id === v.planId);
              const provisioned = v.provisioned === true;
              return (
                <View style={{ gap: 8 }}>
                  {provisioned ? (
                    <TicketCard
                      code={v.code}
                      planName={plan?.name ?? ''}
                      priceXof={plan?.priceXof ?? 0}
                      durationLabel={plan ? fmtDuration(plan.durationMinutes) : ''}
                      compact
                    />
                  ) : (
                    // Ticket non enregistré sur le routeur : ni code, ni QR, ni action de distribution.
                    <View style={{ backgroundColor: theme.surface, borderRadius: 12, padding: 14, gap: 4 }}>
                      <Text style={{ color: theme.warning, fontSize: 14, fontWeight: '700' }}>
                        {t('fichiers.voucherUnavailable')}
                      </Text>
                      <Text style={{ color: theme.textMuted, fontSize: 13 }}>
                        {t('fichiers.voucherNotProvisioned')}
                      </Text>
                    </View>
                  )}
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
                    <Badge label={v.status} tone={STATUS_TONE[v.status]} />
                    {provisioned ? (
                      <View style={{ flex: 1 }}>
                        <Button
                          title={t('common.share')}
                          variant="ghost"
                          onPress={() => shareCodes([v])}
                        />
                      </View>
                    ) : null}
                    {v.status !== 'REVOKED' && v.status !== 'ACTIVE' ? (
                      <View style={{ flex: 1 }}>
                        <Button
                          title={t('common.revoke')}
                          variant="danger"
                          onPress={() => revoke(v.id)}
                        />
                      </View>
                    ) : null}
                    {v.status !== 'ACTIVE' ? (
                      <View style={{ flex: 1 }}>
                        <Button
                          title={t('common.delete')}
                          variant="danger"
                          onPress={() => setConfirmVoucher(v)}
                        />
                      </View>
                    ) : null}
                  </View>
                </View>
              );
        }}
      />
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
        message={
          batchPreviewLoading || !batchPreview
            ? t('fichiers.deleteBatchAnalyzing')
            : buildDeletionMessage(t, 'fichiers.deleteBatchMessageEligible', batchPreview)
        }
        confirmLabel={
          batchPreview
            ? t('fichiers.deleteBatchConfirmLabel', { count: batchPreview.eligible })
            : t('common.delete')
        }
        tone="danger"
        busy={deleteBusy || batchPreviewLoading}
        focusCancel
        onConfirm={deleteBatchConfirmed}
        onCancel={() => {
          setConfirmBatch(null);
          setBatchPreview(null);
        }}
      />

      <ConfirmDialog
        visible={confirmCleanup}
        icon="sparkles-outline"
        title={t('fichiers.cleanupConfirmTitle')}
        message={
          cleanupPreviewLoading || !cleanupPreview
            ? t('fichiers.cleanupAnalyzing')
            : buildDeletionMessage(t, 'fichiers.cleanupMessageEligible', cleanupPreview)
        }
        confirmLabel={
          cleanupPreview
            ? t('fichiers.cleanupConfirmLabel', { count: cleanupPreview.eligible })
            : t('common.delete')
        }
        tone="danger"
        busy={cleanupBusy || cleanupPreviewLoading}
        focusCancel
        onConfirm={cleanupConfirmed}
        onCancel={() => {
          setConfirmCleanup(false);
          setCleanupPreview(null);
        }}
      />
    </View>
  );
}
