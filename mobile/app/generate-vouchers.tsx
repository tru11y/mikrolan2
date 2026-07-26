import { useState } from 'react';
import { Pressable, ScrollView, Share, Text, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api, extractErrorMessage, type Plan, type VoucherItem } from '@/src/lib/api';
import { getLocalCredentials } from '@/src/lib/router-credentials';
import { pushVouchersLan } from '@/src/services/mikrotik-lan/hotspotLan';
import { TicketCard } from '@/src/components/TicketCard';
import { printTickets } from '@/src/lib/ticketsPdf';
import { Badge, Banner, Button, theme } from '@/src/components/ui';
import { BottomNav } from '@/src/components/BottomNav';
import { RouterTopBar } from '@/src/components/RouterTopBar';

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
  const router = useRouter();
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
  const [planId, setPlanId] = useState<string | null>(null);
  const [quantity, setQuantity] = useState(1);
  const [outputFormat, setOutputFormat] = useState<OutputFormat>('screen');
  const [formatOpen, setFormatOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [justGenerated, setJustGenerated] = useState<VoucherItem[] | null>(null);
  const [printBusy, setPrintBusy] = useState(false);

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
        template: r?.ticketTemplate,
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

  async function shareCodes(codes: VoucherItem[]) {
    const text = codes.map((v) => v.code).join('\n');
    await Share.share({ message: `Codes WiFi :\n${text}` });
  }

  const r = routerQuery.data;

  return (
    <View style={{ flex: 1, backgroundColor: theme.bg }}>
      <RouterTopBar title="Tickets" />
      <ScrollView contentContainerStyle={{ gap: 16, padding: 16, paddingBottom: 100 }}>
        <View
          style={{
            flexDirection: 'row',
            alignItems: 'flex-start',
            justifyContent: 'space-between',
          }}
        >
          <View style={{ flex: 1 }}>
            <Text style={{ color: theme.text, fontSize: 20, fontWeight: '700' }}>
              Créer des Tickets
            </Text>
            <Text style={{ color: theme.textMuted, fontSize: 12, marginTop: 2 }}>
              Générez des codes d’accès WiFi uniques RouterOS
            </Text>
          </View>
          <Pressable
            accessibilityLabel="Paramètres du ticket"
            onPress={() =>
              router.push({ pathname: '/ticket-settings', params: { routerId } })
            }
            style={{
              width: 40,
              height: 40,
              borderRadius: 12,
              borderWidth: 1,
              borderColor: theme.border,
              backgroundColor: theme.surfaceAlt,
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <Ionicons name="settings-outline" size={20} color={theme.textMuted} />
          </Pressable>
        </View>

        {error ? <Banner tone="danger">{error}</Banner> : null}

        <View style={{ gap: 16 }}>
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
                {r ? r.alias || r.identity : '…'}
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

          <View>
            <FieldLabel>Quantité de Tickets à Générer</FieldLabel>
            <View
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                justifyContent: 'space-between',
                backgroundColor: theme.surfaceAlt,
                borderWidth: 1,
                borderColor: theme.border,
                borderRadius: 12,
                padding: 6,
              }}
            >
              <Pressable
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
              </Pressable>
              <Text style={{ color: theme.text, fontSize: 20, fontWeight: '800' }}>
                {quantity}
              </Text>
              <Pressable
                accessibilityLabel="Augmenter la quantité"
                onPress={() => setQuantity((q) => Math.min(500, q + 1))}
                disabled={quantity >= 500}
                style={{
                  width: 44,
                  height: 44,
                  borderRadius: 10,
                  backgroundColor: theme.surface,
                  alignItems: 'center',
                  justifyContent: 'center',
                  opacity: quantity >= 500 ? 0.4 : 1,
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
        </View>

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
      </ScrollView>
      <BottomNav active="tickets" />
    </View>
  );
}
