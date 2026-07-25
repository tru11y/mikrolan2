import { useState } from 'react';
import { Pressable, ScrollView, Share, Text, View } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  api,
  extractErrorMessage,
  type Plan,
  type VoucherBatch,
  type VoucherItem,
} from '@/src/lib/api';
import { getLocalCredentials } from '@/src/lib/router-credentials';
import { pushVouchersLan } from '@/src/services/mikrotik-lan/hotspotLan';
import { TicketCard } from '@/src/components/TicketCard';
import { printTickets } from '@/src/lib/ticketsPdf';
import { Badge, Banner, Button, Card, Empty, theme } from '@/src/components/ui';
import { BottomNav } from '@/src/components/BottomNav';

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

function FieldLabel({ children }: { children: string }) {
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

export default function GenerateVouchersScreen() {
  const { routerId } = useLocalSearchParams<{ routerId: string }>();
  const qc = useQueryClient();

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
  const vouchersQuery = useQuery({
    queryKey: ['vouchers', routerId],
    queryFn: () => api.routers.listVouchers(routerId),
    enabled: Boolean(routerId),
  });
  const batchesQuery = useQuery({
    queryKey: ['batches', routerId],
    queryFn: () => api.routers.listBatches(routerId),
    enabled: Boolean(routerId),
  });

  const [planId, setPlanId] = useState<string | null>(null);
  const [quantity, setQuantity] = useState(1);
  const [outputFormat, setOutputFormat] = useState<OutputFormat>('screen');
  const [formatOpen, setFormatOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [justGenerated, setJustGenerated] = useState<VoucherItem[] | null>(null);
  const [printBusy, setPrintBusy] = useState(false);
  const [reprintId, setReprintId] = useState<string | null>(null);

  const selectedPlan = plansQuery.data?.find((p) => p.id === planId) ?? null;

  async function printBatch(codes: VoucherItem[], plan: Plan) {
    setError(null);
    setPrintBusy(true);
    try {
      const r = routerQuery.data;
      await printTickets({
        routerName: r?.alias || r?.identity || 'WiFi',
        planName: plan.name,
        durationMinutes: plan.durationMinutes,
        priceXof: plan.priceXof,
        tickets: codes.map((v) => ({ code: v.code })),
      });
    } catch (e) {
      setError(extractErrorMessage(e));
    } finally {
      setPrintBusy(false);
    }
  }

  async function generate() {
    setError(null);
    if (!planId || quantity < 1) {
      setError('Choisissez un forfait et une quantité.');
      return;
    }
    setBusy(true);
    try {
      const res = await api.routers.generateVouchers(routerId, {
        planId,
        quantity,
      });
      // LOCAL (free) router: the backend recorded the codes but the app must
      // push them to the router over the LAN, then confirm the RouterOS ids.
      if (!res.pushedByServer && res.push) {
        const creds = await getLocalCredentials(routerId);
        if (!creds) {
          setError(
            'Identifiants locaux requis : testez d’abord la connexion LAN sur ce routeur.',
          );
          return;
        }
        const items = await pushVouchersLan(creds, res.vouchers, res.push);
        await api.routers.confirmVouchers(routerId, {
          batchId: res.batchId,
          items,
        });
      }
      setJustGenerated(res.vouchers);
      await qc.invalidateQueries({ queryKey: ['vouchers', routerId] });
      await qc.invalidateQueries({ queryKey: ['batches', routerId] });
      if (outputFormat === 'pdf' && selectedPlan) {
        await printBatch(res.vouchers, selectedPlan);
      }
    } catch (e) {
      setError(extractErrorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  async function reprintBatch(batch: VoucherBatch) {
    setError(null);
    setReprintId(batch.id);
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
      await printTickets({
        routerName: r?.alias || r?.identity || 'WiFi',
        planName: batch.plan.name,
        durationMinutes: plan?.durationMinutes ?? 0,
        priceXof: batch.plan.priceXof,
        tickets: codes.map((v) => ({ code: v.code })),
      });
    } catch (e) {
      setError(extractErrorMessage(e));
    } finally {
      setReprintId(null);
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

  const r = routerQuery.data;

  return (
    <View style={{ flex: 1, backgroundColor: theme.bg }}>
      <ScrollView contentContainerStyle={{ gap: 16, padding: 16, paddingBottom: 100 }}>
        <View>
          <Text style={{ color: theme.text, fontSize: 20, fontWeight: '700' }}>
            Créer des Tickets
          </Text>
          <Text style={{ color: theme.textMuted, fontSize: 12, marginTop: 2 }}>
            Générez des codes d’accès WiFi uniques RouterOS
          </Text>
        </View>

        {error ? <Banner tone="danger">{error}</Banner> : null}

        <Card style={{ gap: 16 }}>
          {/* Serveur Hotspot (routeur déjà sélectionné) */}
          <View>
            <FieldLabel>Serveur Hotspot</FieldLabel>
            <View
              style={{
                backgroundColor: theme.surfaceAlt,
                borderWidth: 1,
                borderColor: theme.border,
                borderRadius: 12,
                paddingHorizontal: 14,
                paddingVertical: 12,
              }}
            >
              <Text style={{ color: theme.text, fontSize: 14, fontWeight: '600' }}>
                {r ? `${r.alias || r.identity} (${r.localAddress ?? r.identity})` : '…'}
              </Text>
            </View>
          </View>

          {/* Forfait / Plan WiFi */}
          <View>
            <FieldLabel>Forfait / Plan WiFi</FieldLabel>
            {plansQuery.isLoading ? (
              <Text style={{ color: theme.textMuted, fontSize: 13 }}>
                Chargement des forfaits…
              </Text>
            ) : !plansQuery.data?.length ? (
              <Text style={{ color: theme.textMuted, fontSize: 13 }}>
                Aucun forfait — créez-en un dans « Forfaits ».
              </Text>
            ) : (
              <View style={{ gap: 8 }}>
                {plansQuery.data.map((p: Plan) => {
                  const selected = p.id === planId;
                  return (
                    <Pressable
                      key={p.id}
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
                    </Pressable>
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
                borderWidth: 1,
                borderColor: theme.border,
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
                Durée : {fmtDuration(selectedPlan.durationMinutes)}
              </Text>
            </View>
          ) : null}

          {/* Format de sortie */}
          <View>
            <FieldLabel>Format de Sortie (Impression / Export)</FieldLabel>
            <Pressable
              onPress={() => setFormatOpen((v) => !v)}
              style={{
                backgroundColor: theme.surfaceAlt,
                borderWidth: 1,
                borderColor: theme.border,
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
                  color={outputFormat === 'screen' ? theme.secondary : theme.primary}
                />
                <Text style={{ color: theme.text, fontSize: 14, fontWeight: '600' }}>
                  {outputFormat === 'screen' ? 'Ticket à l’écran' : 'Fichier PDF'}
                </Text>
              </View>
              <Ionicons name="chevron-down" size={16} color={theme.textMuted} />
            </Pressable>

            {formatOpen ? (
              <View style={{ gap: 8, marginTop: 8 }}>
                {(
                  [
                    {
                      value: 'screen' as const,
                      icon: 'phone-portrait-outline' as const,
                      color: theme.secondary,
                      title: 'Ticket à l’écran',
                      desc: 'Afficher les tickets générés avec QR code',
                    },
                    {
                      value: 'pdf' as const,
                      icon: 'document-text-outline' as const,
                      color: theme.primary,
                      title: 'Fichier PDF',
                      desc: 'Générer un PDF imprimable de tous les tickets',
                    },
                  ]
                ).map((opt) => {
                  const active = outputFormat === opt.value;
                  return (
                    <Pressable
                      key={opt.value}
                      onPress={() => {
                        setOutputFormat(opt.value);
                        setFormatOpen(false);
                      }}
                      style={{
                        borderWidth: 1,
                        borderColor: active ? theme.primary : theme.border,
                        backgroundColor: active ? theme.primary + '18' : theme.surfaceAlt,
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
                    </Pressable>
                  );
                })}
              </View>
            ) : null}
          </View>

          {/* Quantité */}
          <View>
            <FieldLabel>Quantité de Tickets à Générer</FieldLabel>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
              <Pressable
                accessibilityLabel="Diminuer la quantité"
                onPress={() => setQuantity((q) => Math.max(1, q - 1))}
                style={{
                  width: 44,
                  height: 44,
                  borderRadius: 12,
                  borderWidth: 1,
                  borderColor: theme.border,
                  backgroundColor: theme.surfaceAlt,
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                <Ionicons name="remove" size={20} color={theme.text} />
              </Pressable>
              <View
                style={{
                  flex: 1,
                  backgroundColor: theme.surfaceAlt,
                  borderWidth: 1,
                  borderColor: theme.border,
                  borderRadius: 12,
                  paddingVertical: 10,
                  alignItems: 'center',
                }}
              >
                <Text style={{ color: theme.text, fontSize: 18, fontWeight: '700' }}>
                  {quantity}
                </Text>
              </View>
              <Pressable
                accessibilityLabel="Augmenter la quantité"
                onPress={() => setQuantity((q) => Math.min(500, q + 1))}
                style={{
                  width: 44,
                  height: 44,
                  borderRadius: 12,
                  borderWidth: 1,
                  borderColor: theme.border,
                  backgroundColor: theme.surfaceAlt,
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                <Ionicons name="add" size={20} color={theme.text} />
              </Pressable>
            </View>
          </View>

          <Button
            title={`+ Créer des tickets (${quantity})`}
            onPress={generate}
            loading={busy}
          />
        </Card>

        {justGenerated?.length ? (
          <View style={{ gap: 12 }}>
            <View
              style={{
                flexDirection: 'row',
                justifyContent: 'space-between',
                alignItems: 'center',
              }}
            >
              <Text style={{ color: theme.text, fontSize: 14, fontWeight: '700' }}>
                {justGenerated.length} ticket(s) généré(s)
              </Text>
              <Badge label="Nouveau" tone="success" />
            </View>
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
            <Button
              title="Imprimer les tickets (PDF)"
              onPress={() => selectedPlan && printBatch(justGenerated, selectedPlan)}
              loading={printBusy}
            />
            <Button
              title="Partager tous les codes"
              variant="ghost"
              onPress={() => shareCodes(justGenerated)}
            />
          </View>
        ) : null}

        {batchesQuery.data?.length ? (
          <View style={{ gap: 12 }}>
            <Text style={{ color: theme.text, fontSize: 14, fontWeight: '700' }}>
              Lots générés (réimpression)
            </Text>
            {batchesQuery.data.map((b) => (
              <Card key={b.id} style={{ gap: 10 }}>
                <View
                  style={{
                    flexDirection: 'row',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                  }}
                >
                  <View style={{ flex: 1 }}>
                    <Text style={{ color: theme.text, fontWeight: '700' }}>
                      {b.plan.name}
                    </Text>
                    <Text style={{ color: theme.textMuted, fontSize: 12 }}>
                      {new Date(b.createdAt).toLocaleString('fr-FR')} ·{' '}
                      {b.generated}/{b.quantity} tickets
                    </Text>
                  </View>
                  <Badge
                    label={`${b.plan.priceXof.toLocaleString('fr-FR')} F`}
                    tone="gold"
                  />
                </View>
                <Button
                  title="Réimprimer ce lot (PDF)"
                  variant="ghost"
                  onPress={() => reprintBatch(b)}
                  loading={reprintId === b.id}
                />
              </Card>
            ))}
          </View>
        ) : null}

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
                  </View>
                </View>
              );
            })}
          </View>
        )}
      </ScrollView>
      <BottomNav active="tickets" />
    </View>
  );
}
