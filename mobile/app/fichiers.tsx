import { useState } from 'react';
import { Pressable, ScrollView, Share, Text, View } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  api,
  extractErrorMessage,
  type VoucherBatch,
  type VoucherItem,
} from '@/src/lib/api';
import { printTickets, printTicketsDirect } from '@/src/lib/ticketsPdf';
import { TicketCard } from '@/src/components/TicketCard';
import { Badge, Banner, Button, ConfirmDialog, Empty, Subtitle, Title, theme } from '@/src/components/ui';
import { BottomNav, useBottomNavHeight } from '@/src/components/BottomNav';
import { AppHeader } from '@/src/components/AppHeader';

// U+0300-U+036F = plage des diacritiques combinants (issus de normalize('NFD'))
const DIACRITICS_RE = new RegExp('[̀-ͯ]', 'g');

function slug(s: string): string {
  return s
    .normalize('NFD')
    .replace(DIACRITICS_RE, '')
    .replace(/[^a-zA-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

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

function batchFileName(b: VoucherBatch): string {
  const d = new Date(b.createdAt);
  const dd = String(d.getDate()).padStart(2, '0');
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  return `Batch_Tickets_${slug(b.plan.name)}_${dd}${mm}${d.getFullYear()}.pdf`;
}

type BatchAction = { batchId: string; kind: 'download' | 'print' } | null;

export default function FichiersScreen() {
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

  async function batchAction(batch: VoucherBatch, kind: 'download' | 'print') {
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
      const plan = plansQuery.data?.find((p) => p.id === batch.planId);
      const r = routerQuery.data;
      const opts = {
        routerName: r?.alias || r?.identity || 'WiFi',
        planName: batch.plan.name,
        durationMinutes: plan?.durationMinutes ?? 0,
        priceXof: batch.plan.priceXof,
        tickets: codes.map((v) => ({ code: v.code })),
        template: r?.ticketTemplate,
      };
      if (kind === 'download') {
        await printTickets(opts);
      } else {
        await printTicketsDirect(opts);
      }
    } catch (e) {
      setError(extractErrorMessage(e));
    } finally {
      setBusy(null);
    }
  }

  async function shareCodes(codes: VoucherItem[]) {
    const text = codes.map((v) => v.code).join('\n');
    await Share.share({ message: `Codes WiFi :\n${text}` });
  }

  async function revoke(id: string) {
    try {
      await api.routers.revokeVoucher(routerId, id);
      await qc.invalidateQueries({ queryKey: ['vouchers', routerId] });
    } catch (e) {
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
      setError(extractErrorMessage(e));
    } finally {
      setDeleteBusy(false);
    }
  }

  return (
    <View style={{ flex: 1, backgroundColor: theme.bg }}>
      <AppHeader title="Fichiers" back />
      <ScrollView contentContainerStyle={{ gap: 16, padding: 16, paddingBottom: navHeight }}>
        <View>
          <Title>Fichiers &amp; Impression</Title>
          <Subtitle>
            Historique des lots PDF générés et file d&rsquo;impression thermique
          </Subtitle>
        </View>

        {error ? <Banner tone="danger">{error}</Banner> : null}

        <View style={{ gap: 10 }}>
          {!batchesQuery.data?.length ? (
            <Empty text="Aucun lot généré pour ce routeur." />
          ) : (
            batchesQuery.data.map((b) => {
              const isDownloading =
                busy?.batchId === b.id && busy.kind === 'download';
              const isPrinting = busy?.batchId === b.id && busy.kind === 'print';
              return (
                <View
                  key={b.id}
                  style={{
                    flexDirection: 'row',
                    alignItems: 'center',
                    gap: 12,
                    backgroundColor: theme.surface,
                    borderWidth: 1,
                    borderColor: theme.border,
                    borderRadius: 16,
                    padding: 14,
                  }}
                >
                  <View
                    style={{
                      width: 44,
                      height: 44,
                      borderRadius: 12,
                      backgroundColor: theme.primary + '22',
                      alignItems: 'center',
                      justifyContent: 'center',
                    }}
                  >
                    <Ionicons name="document-text" size={22} color={theme.primary} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text
                      numberOfLines={1}
                      style={{ color: theme.text, fontWeight: '700', fontSize: 13 }}
                    >
                      {batchFileName(b)}
                    </Text>
                    <Text style={{ color: theme.textMuted, fontSize: 11, marginTop: 2 }}>
                      {b.generated} tickets · {new Date(b.createdAt).toLocaleDateString('fr-FR')}
                    </Text>
                  </View>
                  <Pressable
                    accessibilityLabel="Télécharger le lot"
                    onPress={() => batchAction(b, 'download')}
                    disabled={busy !== null}
                    style={{
                      width: 38,
                      height: 38,
                      borderRadius: 10,
                      borderWidth: 1,
                      borderColor: theme.secondary + '40',
                      backgroundColor: theme.secondary + '18',
                      alignItems: 'center',
                      justifyContent: 'center',
                      opacity: isDownloading ? 0.5 : 1,
                    }}
                  >
                    <Ionicons name="download-outline" size={17} color={theme.secondary} />
                  </Pressable>
                  <Pressable
                    accessibilityLabel="Imprimer le lot"
                    onPress={() => batchAction(b, 'print')}
                    disabled={busy !== null}
                    style={{
                      width: 38,
                      height: 38,
                      borderRadius: 10,
                      borderWidth: 1,
                      borderColor: theme.primary + '40',
                      backgroundColor: theme.primary + '18',
                      alignItems: 'center',
                      justifyContent: 'center',
                      opacity: isPrinting ? 0.5 : 1,
                    }}
                  >
                    <Ionicons name="print-outline" size={17} color={theme.primary} />
                  </Pressable>
                  <Pressable
                    accessibilityLabel="Supprimer le lot"
                    onPress={() => setConfirmBatch(b)}
                    disabled={busy !== null}
                    style={{
                      width: 38,
                      height: 38,
                      borderRadius: 10,
                      borderWidth: 1,
                      borderColor: theme.danger + '40',
                      backgroundColor: theme.danger + '18',
                      alignItems: 'center',
                      justifyContent: 'center',
                    }}
                  >
                    <Ionicons name="trash-outline" size={17} color={theme.danger} />
                  </Pressable>
                </View>
              );
            })
          )}
        </View>

        <Text style={{ color: theme.text, fontSize: 14, fontWeight: '700' }}>
          Codes existants
        </Text>
        {vouchersQuery.isLoading ? (
          <Text style={{ color: theme.textMuted, fontSize: 13 }}>Chargement…</Text>
        ) : !vouchersQuery.data?.length ? (
          <Empty text="Aucun code pour ce routeur." />
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
                        title="Partager"
                        variant="ghost"
                        onPress={() => shareCodes([v])}
                      />
                    </View>
                    {v.status !== 'REVOKED' ? (
                      <View style={{ flex: 1 }}>
                        <Button
                          title="Révoquer"
                          variant="danger"
                          onPress={() => revoke(v.id)}
                        />
                      </View>
                    ) : null}
                    <View style={{ flex: 1 }}>
                      <Button
                        title="Supprimer"
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
        title="Supprimer ce ticket ?"
        message={`Le code ${confirmVoucher?.code ?? ''} sera supprimé définitivement — impossible à annuler.`}
        confirmLabel="Supprimer"
        tone="danger"
        busy={deleteBusy}
        onConfirm={deleteVoucherConfirmed}
        onCancel={() => setConfirmVoucher(null)}
      />

      <ConfirmDialog
        visible={confirmBatch !== null}
        icon="trash-outline"
        title="Supprimer ce lot ?"
        message={`${confirmBatch?.generated ?? 0} ticket(s) de ce lot seront supprimés définitivement — impossible à annuler.`}
        confirmLabel="Supprimer"
        tone="danger"
        busy={deleteBusy}
        onConfirm={deleteBatchConfirmed}
        onCancel={() => setConfirmBatch(null)}
      />
    </View>
  );
}
