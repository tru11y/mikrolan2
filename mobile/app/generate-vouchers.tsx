export { ScreenErrorBoundary as ErrorBoundary } from '@/src/components/ScreenErrorBoundary';
import axios from 'axios';
import { useState } from 'react';
import { ScrollView, Share, Text, TextInput, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api, type Plan, type VoucherItem, type GenerateResult } from '@/src/lib/api';
import { useTranslation } from 'react-i18next';
import { describeError } from '@/src/lib/errors';
import { getLocalCredentials } from '@/src/lib/router-credentials';
import { PartialPushError, pushVouchersLan } from '@/src/services/mikrotik-lan/hotspotLan';
import { reportSilent, swallow } from '@/src/lib/report';
import { TicketCard } from '@/src/components/TicketCard';
import { printTickets, printTicketsDirect } from '@/src/lib/ticketsPdf';
import {
  Banner,
  Button,
  ErrorState,
  FadeIn,
  Press,
  Skeleton,
  useToast,
  withAlpha,
} from '@/src/components/ui';
import { useTheme, type ThemeColors } from '@/src/providers/theme-provider';
import { BottomNav, useBottomNavHeight } from '@/src/components/BottomNav';
import { AppHeader } from '@/src/components/AppHeader';

/** Plafond serveur d'un lot de tickets. */
const MAX_QUANTITY = 500;

function FieldLabel({ children }: { children: string }) {
  const theme = useTheme();
  return (
    <Text
      style={{
        color: theme.textMuted,
        fontSize: 12,
        fontWeight: '500',
        marginBottom: 4,
      }}
    >
      {children}
    </Text>
  );
}

function fmtDuration(min: number): string {
  if (min % 1440 === 0) return `${min / 1440}j`;
  if (min % 60 === 0) return `${min / 60}h`;
  return `${min}min`;
}

type OutputFormat = 'screen' | 'pdf';
type TFn = (key: string, opts?: Record<string, unknown>) => string;

function Row({
  label,
  value,
  theme,
  emphasis,
}: {
  label: string;
  value: string;
  theme: ThemeColors;
  emphasis?: boolean;
}) {
  return (
    <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
      <Text style={{ color: theme.textMuted, fontSize: emphasis ? 13 : 12 }}>{label}</Text>
      <Text
        style={{
          color: emphasis ? theme.success : theme.text,
          fontSize: emphasis ? 15 : 13,
          fontWeight: emphasis ? '800' : '600',
        }}
      >
        {value}
      </Text>
    </View>
  );
}

/**
 * Résumé compact post-génération : pas de dizaines/centaines de TicketCard
 * affichées d'office (ça surcharge l'écran pour un lot de 100) — juste le
 * verdict, la valeur du lot, et les actions immédiates. Le détail des tickets
 * reste un tap volontaire ("Voir").
 */
function BatchResult({
  theme,
  t,
  outcome,
  batchSeq,
  plan,
  quantity,
  pushed,
  total,
  failureMessage,
  showTickets,
  onToggleTickets,
  onPrintPdf,
  onPrintDirect,
  onShare,
  onNewBatch,
  printBusy,
  printDirectBusy,
}: {
  theme: ThemeColors;
  t: TFn;
  outcome: 'SUCCESS' | 'PARTIAL_SUCCESS' | 'FAILED';
  batchSeq: number | null;
  plan: Plan | null;
  quantity: number;
  pushed: number;
  total: number;
  failureMessage: string | null;
  showTickets: boolean;
  onToggleTickets: () => void;
  onPrintPdf: () => void;
  onPrintDirect: () => void;
  onShare: () => void;
  onNewBatch: () => void;
  printBusy: boolean;
  printDirectBusy: boolean;
}) {
  const failed = outcome === 'FAILED';
  const partial = outcome === 'PARTIAL_SUCCESS';
  const tone = failed ? 'danger' : partial ? 'warning' : 'success';
  const title = failed
    ? t('tickets.failedTitle')
    : partial
      ? t('tickets.partialTitle', { pushed, total, failed: total - pushed })
      : t('tickets.completedTitle', { count: quantity });

  return (
    <Banner tone={tone}>
      <View style={{ gap: 10 }}>
        <Text style={{ color: theme.text, fontSize: 14, fontWeight: '700' }}>{title}</Text>
        {failed && failureMessage ? (
          <Text style={{ color: theme.textMuted, fontSize: 12 }}>{failureMessage}</Text>
        ) : null}
        {!failed ? (
          <View style={{ gap: 4 }}>
            {batchSeq != null ? (
              <Row label={t('tickets.batchLabel', { seq: batchSeq })} value="" theme={theme} />
            ) : null}
            <Row label={t('tickets.wifiPlan')} value={plan?.name ?? ''} theme={theme} />
            <Row label={t('tickets.quantity')} value={String(quantity)} theme={theme} />
            <Row
              label={t('tickets.totalValue')}
              value={`${((plan?.priceXof ?? 0) * quantity).toLocaleString('fr-FR')} FCFA`}
              theme={theme}
              emphasis
            />
          </View>
        ) : null}
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
          {failed ? (
            <View style={{ flex: 1 }}>
              <Button title={t('tickets.newBatch')} onPress={onNewBatch} />
            </View>
          ) : (
            <>
              <View style={{ flex: 1, minWidth: '30%' }}>
                <Button
                  title={showTickets ? t('tickets.hideTickets') : t('tickets.viewTickets')}
                  variant="ghost"
                  onPress={onToggleTickets}
                />
              </View>
              <View style={{ flex: 1, minWidth: '30%' }}>
                <Button title={t('tickets.pdfFile')} variant="ghost" onPress={onPrintPdf} loading={printBusy} />
              </View>
              <View style={{ flex: 1, minWidth: '30%' }}>
                <Button title={t('common.share')} variant="ghost" onPress={onShare} />
              </View>
              <View style={{ flex: 1, minWidth: '30%' }}>
                <Button
                  title={t('tickets.printDirect')}
                  variant="ghost"
                  onPress={onPrintDirect}
                  loading={printDirectBusy}
                />
              </View>
              <View style={{ flex: 1, minWidth: '30%' }}>
                <Button title={t('tickets.newBatch')} onPress={onNewBatch} />
              </View>
            </>
          )}
        </View>
      </View>
    </Banner>
  );
}

export default function GenerateVouchersScreen() {
  const theme = useTheme();
  const { routerId } = useLocalSearchParams<{ routerId: string }>();
  const router = useRouter();
  const { t } = useTranslation();
  const qc = useQueryClient();
  const toast = useToast();
  const navHeight = useBottomNavHeight();

  const plansQuery = useQuery({
    queryKey: ['plans', routerId],
    queryFn: () => api.plans.list(routerId),
    enabled: Boolean(routerId),
  });
  const routerQuery = useQuery({
    queryKey: ['router', routerId],
    queryFn: () => api.routers.get(routerId),
    enabled: Boolean(routerId),
  });
  const [planId, setPlanId] = useState<string | null>(null);
  const [quantity, setQuantity] = useState(1);
  const [outputFormat, setOutputFormat] = useState<OutputFormat>('screen');
  const [formatOpen, setFormatOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [justGenerated, setJustGenerated] = useState<VoucherItem[] | null>(null);
  const [lastBatchSeq, setLastBatchSeq] = useState<number | null>(null);
  const [printBusy, setPrintBusy] = useState(false);
  const [printDirectBusy, setPrintDirectBusy] = useState(false);
  const [showTickets, setShowTickets] = useState(false);
  type GenOutcome = 'SUCCESS' | 'PARTIAL_SUCCESS' | 'FAILED';
  const [lastOutcome, setLastOutcome] = useState<GenOutcome | null>(null);
  const [lastPushed, setLastPushed] = useState(0);
  const [lastTotal, setLastTotal] = useState(0);
  const [lastFailureMessage, setLastFailureMessage] = useState<string | null>(null);

  const selectedPlan = plansQuery.data?.find((p) => p.id === planId) ?? null;
  const totalValueXof = (selectedPlan?.priceXof ?? 0) * quantity;

  async function printBatch(codes: VoucherItem[], plan: Plan) {
    setPrintBusy(true);
    try {
      const r = routerQuery.data;
      await printTickets({
        routerName: r?.alias || r?.identity || 'WiFi',
        planName: plan.name,
        durationMinutes: plan.durationMinutes,
        priceXof: plan.priceXof,
        tickets: codes.map((v) => ({ code: v.code })),
        template: r?.ticketTemplate,
        batchSeq: lastBatchSeq ?? undefined,
      });
    } catch (e) {
      reportSilent('generate-vouchers.print-batch', e, { routerId });
      toast.error(describeError(e).message);
    } finally {
      setPrintBusy(false);
    }
  }

  async function printDirect(codes: VoucherItem[], plan: Plan) {
    setPrintDirectBusy(true);
    try {
      const r = routerQuery.data;
      await printTicketsDirect({
        routerName: r?.alias || r?.identity || 'WiFi',
        planName: plan.name,
        durationMinutes: plan.durationMinutes,
        priceXof: plan.priceXof,
        tickets: codes.map((v) => ({ code: v.code })),
        template: r?.ticketTemplate,
        batchSeq: lastBatchSeq ?? undefined,
      });
    } catch (e) {
      reportSilent('generate-vouchers.print-direct', e, { routerId });
      toast.error(describeError(e).message);
    } finally {
      setPrintDirectBusy(false);
    }
  }

  async function generate() {
    if (!planId) {
      toast.error(t('tickets.choosePlanFirst'));
      return;
    }
    if (quantity < 1 || quantity > MAX_QUANTITY) {
      toast.error(t('tickets.quantityRange', { max: MAX_QUANTITY }));
      return;
    }
    setBusy(true);
    setLastOutcome(null);
    setLastFailureMessage(null);
    setShowTickets(false);
    let res: GenerateResult | null = null;
    try {
      res = await api.routers.generateVouchers(routerId, {
        planId,
        quantity,
      });
    } catch (e) {
      reportSilent('generate-vouchers.generate', e, { routerId, planId, quantity });
      setLastOutcome('FAILED');
      setLastFailureMessage(describeError(e).message);
      setBusy(false);
      return;
    }

    setLastBatchSeq(res.batchSeq);
    let outcome: GenOutcome =
      res.batchStatus === 'COMPLETED' ? 'SUCCESS'
      : res.batchStatus === 'PARTIAL_SUCCESS' ? 'PARTIAL_SUCCESS'
      : 'FAILED';

    let pushedCount = res.pushedCount;
    let failureMessage: string | null = null;

    if (outcome === 'SUCCESS' && !res.pushedByServer && res.push) {
      const reportFailure = (reason: string, code: string, pushed: number) =>
        api.routers
          .reportPushFailure(routerId, {
            batchId: res.batchId,
            reason,
            errorCode: code,
            pushedCount: pushed,
          })
          .catch(swallow('generate.report-push-failure'));
      try {
        const creds = await getLocalCredentials(routerId);
        if (!creds) {
          failureMessage = t('tickets.localCredsRequired');
          pushedCount = 0;
          await reportFailure(failureMessage, 'ROUTER_CREDS_MISSING', 0);
          outcome = 'FAILED';
        } else {
          const items = await pushVouchersLan(creds, res.vouchers, res.push);
          pushedCount = items.length;
          await api.routers.confirmVouchers(routerId, {
            batchId: res.batchId,
            items,
          });
        }
      } catch (e) {
        const described = describeError(e);
        failureMessage = axios.isAxiosError(e) ? described.message : t('tickets.lanPushFailed');
        if (e instanceof PartialPushError) {
          pushedCount = e.pushed.length;
          await api.routers
            .confirmVouchers(routerId, { batchId: res.batchId, items: e.pushed })
            .catch(swallow('generate.confirm-partial'));
          outcome = 'PARTIAL_SUCCESS';
        } else {
          pushedCount = 0;
          await reportFailure(described.message, described.errorCode ?? (e instanceof Error ? e.name : 'LAN_PUSH_FAILED'), 0);
          outcome = 'FAILED';
        }
      }
    }

    setLastOutcome(outcome);
    setLastPushed(pushedCount);
    setLastTotal(res.totalCount);
    setLastFailureMessage(failureMessage);
    setJustGenerated(res.vouchers);
    await qc.invalidateQueries({ queryKey: ['vouchers', routerId] });
    await qc.invalidateQueries({ queryKey: ['batches', routerId] });

    if (outputFormat === 'pdf' && selectedPlan && res.vouchers.length) {
      await printBatch(res.vouchers, selectedPlan);
    }
    setBusy(false);
  }

  function newBatch() {
    setJustGenerated(null);
    setLastOutcome(null);
    setLastFailureMessage(null);
    setShowTickets(false);
  }

  async function shareCodes(codes: VoucherItem[]) {
    try {
      const text = codes.map((v) => v.code).join('\n');
      await Share.share({ message: `${t('tickets.wifiCodes')}\n${text}` });
    } catch (e) {
      reportSilent('generate-vouchers.share', e, { routerId });
      toast.error(describeError(e).message);
    }
  }

  const r = routerQuery.data;

  return (
    <View style={{ flex: 1, backgroundColor: theme.bg }}>
      <AppHeader title={t('bottomNav.tickets')} back />
      <ScrollView contentContainerStyle={{ gap: 16, padding: 16, paddingBottom: navHeight }}>
        <View
          style={{
            flexDirection: 'row',
            alignItems: 'flex-start',
            justifyContent: 'space-between',
          }}
        >
          <View style={{ flex: 1 }}>
            <Text style={{ color: theme.text, fontSize: 20, fontWeight: '700' }}>
              {t('tickets.createTickets')}
            </Text>
            <Text style={{ color: theme.textMuted, fontSize: 12, marginTop: 2 }}>
              {t('tickets.generateSubtitle')}
            </Text>
          </View>
          <Press
            accessibilityLabel={t('tickets.ticketSettings')}
            onPress={() =>
              router.push({ pathname: '/ticket-settings', params: { routerId } })
            }
            style={{
              width: 40,
              height: 40,
              borderRadius: 12,
              backgroundColor: theme.surfaceAlt,
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <Ionicons name="settings-outline" size={20} color={theme.textMuted} />
          </Press>
        </View>

        <Press
          accessibilityRole="button"
          accessibilityLabel={t('tickets.verifyTicket')}
          onPress={() => router.push({ pathname: '/verify-ticket', params: { routerId } })}
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            gap: 12,
            backgroundColor: theme.surface,
            borderRadius: 12,
            padding: 14,
          }}
        >
          <View
            style={{
              width: 40,
              height: 40,
              borderRadius: 12,
              backgroundColor: withAlpha(theme.primary, 0.13),
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <Ionicons name="shield-checkmark-outline" size={20} color={theme.primary} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={{ color: theme.text, fontWeight: '700' }}>{t('tickets.verifyTicket')}</Text>
            <Text style={{ color: theme.textMuted, fontSize: 12 }}>
              {t('tickets.verifySubtitle')}
            </Text>
          </View>
          <Ionicons name="chevron-forward" size={18} color={theme.textMuted} />
        </Press>

        <View style={{ gap: 16 }}>
          {/* Serveur Hotspot (routeur déjà sélectionné) */}
          <View>
            <FieldLabel>{t('tickets.hotspotServer')}</FieldLabel>
            <View
              style={{
                backgroundColor: theme.surfaceAlt,
                borderRadius: 12,
                paddingHorizontal: 14,
                paddingVertical: 12,
              }}
            >
              <Text style={{ color: theme.text, fontSize: 14, fontWeight: '600' }}>
                {r ? r.alias || r.identity : '…'}
              </Text>
            </View>
          </View>

          {/* Forfait / Plan WiFi */}
          <View>
            <FieldLabel>{t('tickets.wifiPlan')}</FieldLabel>
            {plansQuery.isLoading ? (
              <View style={{ gap: 8 }}>
                {[0, 1, 2].map((i) => (
                  <Skeleton key={i} height={46} radius={12} />
                ))}
              </View>
            ) : plansQuery.isError ? (
              <ErrorState
                compact
                message={describeError(plansQuery.error).message}
                onRetry={() => plansQuery.refetch()}
                retrying={plansQuery.isFetching}
              />
            ) : !plansQuery.data?.length ? (
              <Press
                accessibilityLabel={t('tickets.createPlan')}
                onPress={() => router.push({ pathname: '/plans', params: { routerId } })}
                style={{
                  backgroundColor: withAlpha(theme.primary, 0.08),
                  borderRadius: 12,
                  padding: 14,
                  flexDirection: 'row',
                  alignItems: 'center',
                  gap: 10,
                }}
              >
                <Ionicons name="add-circle-outline" size={18} color={theme.primary} />
                <Text style={{ color: theme.primary, fontSize: 13, fontWeight: '600' }}>
                  {t('tickets.noPlan')}
                </Text>
              </Press>
            ) : (
              <View style={{ gap: 8 }}>
                {plansQuery.data.map((p: Plan, i: number) => {
                  const selected = p.id === planId;
                  return (
                    <FadeIn key={p.id} delay={i * 45}>
                    <Press
                      accessibilityRole="radio"
                      accessibilityLabel={p.name}
                      onPress={() => setPlanId(p.id)}
                      style={{
                        borderWidth: 1,
                        borderColor: selected ? theme.primary : theme.border,
                        backgroundColor: selected ? theme.surfaceAlt : 'transparent',
                        borderRadius: 12,
                        paddingHorizontal: 14,
                        paddingVertical: 12,
                        flexDirection: 'row',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                      }}
                    >
                      <Text style={{ color: theme.text, fontSize: 14, fontWeight: '500' }}>
                        {p.name}
                      </Text>
                      <Text
                        style={{ color: theme.success, fontSize: 12, fontWeight: '700' }}
                      >
                        {p.priceXof.toLocaleString('fr-FR')} FCFA
                      </Text>
                    </Press>
                    </FadeIn>
                  );
                })}
              </View>
            )}
          </View>

          {/* Résumé du forfait sélectionné */}
          {selectedPlan ? (
            <View
              style={{
                backgroundColor: theme.surfaceAlt,
                borderRadius: 12,
                padding: 12,
                gap: 2,
              }}
            >
              <View
                style={{
                  flexDirection: 'row',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                }}
              >
                <Text style={{ color: theme.text, fontSize: 12, fontWeight: '700' }}>
                  {selectedPlan.name}
                </Text>
                <Text style={{ color: theme.success, fontSize: 12, fontWeight: '700' }}>
                  {selectedPlan.priceXof.toLocaleString('fr-FR')} FCFA
                </Text>
              </View>
              <Text style={{ color: theme.textMuted, fontSize: 12 }}>
                {t('tickets.duration', { duration: fmtDuration(selectedPlan.durationMinutes) })}
              </Text>
            </View>
          ) : null}

          {/* Format de sortie */}
          <View>
            <FieldLabel>{t('tickets.outputFormat')}</FieldLabel>
            <Press
              onPress={() => setFormatOpen((v) => !v)}
              style={{
                backgroundColor: theme.surfaceAlt,
                borderRadius: 12,
                paddingHorizontal: 14,
                paddingVertical: 12,
                flexDirection: 'row',
                alignItems: 'center',
                justifyContent: 'space-between',
              }}
            >
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                <Ionicons
                  name={outputFormat === 'screen' ? 'phone-portrait-outline' : 'document-text-outline'}
                  size={18}
                  color={outputFormat === 'screen' ? theme.primaryMuted : theme.primary}
                />
                <Text style={{ color: theme.text, fontSize: 14, fontWeight: '600' }}>
                  {outputFormat === 'screen' ? t('tickets.screenTicket') : t('tickets.pdfFile')}
                </Text>
              </View>
              <Ionicons name="chevron-down" size={16} color={theme.textMuted} />
            </Press>

            {formatOpen ? (
              <View style={{ gap: 8, marginTop: 8 }}>
                {(
                  [
                    {
                      value: 'screen' as const,
                      icon: 'phone-portrait-outline' as const,
                      color: theme.primaryMuted,
                      title: t('tickets.screenTicket'),
                      desc: t('tickets.screenTicketDesc'),
                    },
                    {
                      value: 'pdf' as const,
                      icon: 'document-text-outline' as const,
                      color: theme.primary,
                      title: t('tickets.pdfFile'),
                      desc: t('tickets.pdfFileDesc'),
                    },
                  ]
                ).map((opt) => {
                  const active = outputFormat === opt.value;
                  return (
                    <Press
                      key={opt.value}
                      onPress={() => {
                        setOutputFormat(opt.value);
                        setFormatOpen(false);
                      }}
                      style={{
                        borderWidth: 1,
                        borderColor: active ? theme.primary : theme.border,
                        backgroundColor: active ? withAlpha(theme.primary, 0.09) : theme.surfaceAlt,
                        borderRadius: 14,
                        padding: 12,
                        flexDirection: 'row',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                      }}
                    >
                      <View
                        style={{ flexDirection: 'row', alignItems: 'center', gap: 10, flex: 1 }}
                      >
                        <Ionicons name={opt.icon} size={18} color={opt.color} />
                        <View style={{ flex: 1 }}>
                          <Text style={{ color: theme.text, fontSize: 13, fontWeight: '700' }}>
                            {opt.title}
                          </Text>
                          <Text style={{ color: theme.textMuted, fontSize: 11 }}>
                            {opt.desc}
                          </Text>
                        </View>
                      </View>
                      {active ? (
                        <Ionicons name="checkmark" size={18} color={theme.primary} />
                      ) : null}
                    </Press>
                  );
                })}
              </View>
            ) : null}
          </View>

          <View>
            <FieldLabel>{t('tickets.quantity')}</FieldLabel>
            <View
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                justifyContent: 'space-between',
                backgroundColor: theme.surfaceAlt,
                borderRadius: 12,
                padding: 6,
              }}
            >
              <Press
                accessibilityLabel="Diminuer la quantité"
                onPress={() => setQuantity((q) => Math.max(1, q - 1))}
                disabled={quantity <= 1}
                style={{
                  width: 44,
                  height: 44,
                  borderRadius: 10,
                  backgroundColor: theme.surface,
                  alignItems: 'center',
                  justifyContent: 'center',
                  opacity: quantity <= 1 ? 0.4 : 1,
                }}
              >
                <Ionicons name="remove" size={20} color={theme.text} />
              </Press>
              {/* Saisie directe : générer 200 tickets ne peut pas passer par
                  200 appuis sur « + ». */}
              <TextInput
                accessibilityLabel="Quantité de tickets"
                value={String(quantity)}
                onChangeText={(v) => {
                  const digits = v.replace(/[^0-9]/g, '').slice(0, 3);
                  setQuantity(
                    digits === ''
                      ? 0
                      : Math.min(MAX_QUANTITY, Number.parseInt(digits, 10)),
                  );
                }}
                onBlur={() => setQuantity((q) => Math.max(1, q))}
                keyboardType="number-pad"
                inputMode="numeric"
                selectTextOnFocus
                style={{
                  color: theme.text,
                  fontSize: 20,
                  fontWeight: '800',
                  minWidth: 70,
                  textAlign: 'center',
                  paddingVertical: 4,
                }}
              />
              <Press
                accessibilityLabel="Augmenter la quantité"
                onPress={() => setQuantity((q) => Math.min(MAX_QUANTITY, q + 1))}
                disabled={quantity >= MAX_QUANTITY}
                style={{
                  width: 44,
                  height: 44,
                  borderRadius: 10,
                  backgroundColor: theme.surface,
                  alignItems: 'center',
                  justifyContent: 'center',
                  opacity: quantity >= MAX_QUANTITY ? 0.4 : 1,
                }}
              >
                <Ionicons name="add" size={20} color={theme.text} />
              </Press>
            </View>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 8 }}>
              {[1, 5, 10, 20, 50, 100].map((n) => (
                <Press
                  key={n}
                  accessibilityLabel={`${n} tickets`}
                  onPress={() => setQuantity(n)}
                  style={{
                    flexBasis: '30%',
                    flexGrow: 1,
                    borderWidth: 1,
                    borderColor: quantity === n ? theme.primary : theme.border,
                    backgroundColor:
                      quantity === n ? withAlpha(theme.primary, 0.1) : 'transparent',
                    borderRadius: 10,
                    paddingVertical: 8,
                    alignItems: 'center',
                  }}
                >
                  <Text
                    style={{
                      color: quantity === n ? theme.primary : theme.textMuted,
                      fontSize: 13,
                      fontWeight: '700',
                    }}
                  >
                    {n}
                  </Text>
                </Press>
              ))}
            </View>
          </View>

          {selectedPlan ? (
            <View
              style={{
                backgroundColor: theme.surfaceAlt,
                borderRadius: 12,
                padding: 14,
                gap: 8,
              }}
            >
              <Text style={{ color: theme.textMuted, fontSize: 11, fontWeight: '700', textTransform: 'uppercase' }}>
                {t('tickets.summaryTitle')}
              </Text>
              <Row label={t('tickets.hotspotServer')} value={r ? r.alias || r.identity : '—'} theme={theme} />
              <Row label={t('tickets.wifiPlan')} value={selectedPlan.name} theme={theme} />
              <Row
                label={t('tickets.unitPrice')}
                value={`${selectedPlan.priceXof.toLocaleString('fr-FR')} FCFA`}
                theme={theme}
              />
              <Row label={t('tickets.quantity')} value={String(quantity)} theme={theme} />
              <View
                style={{
                  height: 1,
                  backgroundColor: theme.border,
                  marginVertical: 2,
                }}
              />
              <Row
                label={t('tickets.totalValue')}
                value={`${totalValueXof.toLocaleString('fr-FR')} FCFA`}
                theme={theme}
                emphasis
              />
            </View>
          ) : null}

          <Button
            title={t('tickets.createButton', { count: quantity })}
            onPress={generate}
            loading={busy}
            disabled={!selectedPlan}
          />
        </View>

        {lastOutcome ? (
          <BatchResult
            theme={theme}
            t={t}
            outcome={lastOutcome}
            batchSeq={lastBatchSeq}
            plan={selectedPlan}
            quantity={lastOutcome === 'PARTIAL_SUCCESS' ? lastPushed : (justGenerated?.length ?? quantity)}
            pushed={lastPushed}
            total={lastTotal}
            failureMessage={lastFailureMessage}
            showTickets={showTickets}
            onToggleTickets={() => setShowTickets((v) => !v)}
            onPrintPdf={() => justGenerated && selectedPlan && printBatch(justGenerated, selectedPlan)}
            onPrintDirect={() => justGenerated && selectedPlan && printDirect(justGenerated, selectedPlan)}
            onShare={() => justGenerated && shareCodes(justGenerated)}
            onNewBatch={newBatch}
            printBusy={printBusy}
            printDirectBusy={printDirectBusy}
          />
        ) : null}

        {showTickets && justGenerated?.length ? (
          <View style={{ gap: 12 }}>
            {justGenerated.map((v, i) => (
              <TicketCard
                key={v.id}
                code={v.code}
                planName={selectedPlan?.name ?? ''}
                priceXof={selectedPlan?.priceXof ?? 0}
                durationLabel={
                  selectedPlan ? fmtDuration(selectedPlan.durationMinutes) : ''
                }
                ticketNumber={i + 1}
                createdAt={new Date(v.createdAt)}
              />
            ))}
          </View>
        ) : null}
      </ScrollView>
      <BottomNav active="tickets" />
    </View>
  );
}
