import { useState } from 'react';
import { Pressable, ScrollView, Share, Text, View } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
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
import { TicketQr } from '@/src/components/TicketQr';
import { printTickets } from '@/src/lib/ticketsPdf';
import {
  Badge,
  Banner,
  Button,
  Card,
  Empty,
  Field,
  Label,
  Subtitle,
  Title,
  theme,
} from '@/src/components/ui';
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
  const [quantity, setQuantity] = useState('10');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [justGenerated, setJustGenerated] = useState<VoucherItem[] | null>(null);
  const [printBusy, setPrintBusy] = useState(false);
  const [reprintId, setReprintId] = useState<string | null>(null);

  async function generate() {
    setError(null);
    const qty = Number.parseInt(quantity, 10);
    if (!planId || !qty || qty < 1) {
      setError('Choisissez un forfait et une quantité.');
      return;
    }
    setBusy(true);
    try {
      const res = await api.routers.generateVouchers(routerId, {
        planId,
        quantity: qty,
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
    } catch (e) {
      setError(extractErrorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  async function printBatch(codes: VoucherItem[]) {
    const plan = plansQuery.data?.find((p) => p.id === codes[0]?.planId);
    if (!plan) {
      setError('Forfait introuvable pour ces tickets.');
      return;
    }
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

  return (
    <View style={{ flex: 1, backgroundColor: theme.bg }}>
      <ScrollView contentContainerStyle={{ gap: 16, padding: 16, paddingBottom: 100 }}>
        <Title>Créer des tickets</Title>
        <Subtitle>
          Générez des codes d’accès WiFi uniques, puis distribuez-les à vos
          clients (partage ou lecture).
        </Subtitle>

        {error ? <Banner tone="danger">{error}</Banner> : null}

        <Card>
          <Label>Forfait</Label>
          {plansQuery.isLoading ? (
            <Subtitle>Chargement des forfaits…</Subtitle>
          ) : !plansQuery.data?.length ? (
            <Subtitle>Aucun forfait — créez-en un dans « Forfaits ».</Subtitle>
          ) : (
            plansQuery.data.map((p: Plan) => {
              const selected = p.id === planId;
              return (
                <Pressable
                  key={p.id}
                  onPress={() => setPlanId(p.id)}
                  style={{
                    borderWidth: 1,
                    borderColor: selected ? theme.primary : theme.border,
                    backgroundColor: selected ? theme.surfaceAlt : 'transparent',
                    borderRadius: 10,
                    padding: 12,
                    flexDirection: 'row',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                  }}
                >
                  <Text style={{ color: theme.text, fontWeight: '600' }}>
                    {p.name}
                  </Text>
                  <Badge
                    label={`${p.priceXof.toLocaleString('fr-FR')} FCFA`}
                    tone="gold"
                  />
                </Pressable>
              );
            })
          )}
          <Label>Quantité de tickets</Label>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
            <Pressable
              accessibilityLabel="Diminuer la quantité"
              onPress={() =>
                setQuantity((q) =>
                  String(Math.max(1, (Number.parseInt(q, 10) || 1) - 1)),
                )
              }
              style={{
                width: 46,
                height: 46,
                borderRadius: 12,
                borderWidth: 1,
                borderColor: theme.border,
                backgroundColor: theme.surfaceAlt,
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <Text style={{ color: theme.text, fontSize: 22, fontWeight: '700' }}>
                −
              </Text>
            </Pressable>
            <View style={{ flex: 1 }}>
              <Field
                value={quantity}
                onChangeText={setQuantity}
                keyboardType="number-pad"
                textAlign="center"
              />
            </View>
            <Pressable
              accessibilityLabel="Augmenter la quantité"
              onPress={() =>
                setQuantity((q) => String((Number.parseInt(q, 10) || 0) + 1))
              }
              style={{
                width: 46,
                height: 46,
                borderRadius: 12,
                borderWidth: 1,
                borderColor: theme.border,
                backgroundColor: theme.surfaceAlt,
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <Text style={{ color: theme.text, fontSize: 22, fontWeight: '700' }}>
                +
              </Text>
            </Pressable>
          </View>
          <Button
            title={`Générer ${Number.parseInt(quantity, 10) || 0} tickets`}
            onPress={generate}
            loading={busy}
          />
        </Card>

        {justGenerated?.length ? (
          <Card>
            <View
              style={{
                flexDirection: 'row',
                justifyContent: 'space-between',
                alignItems: 'center',
              }}
            >
              <Label>{justGenerated.length} code(s) généré(s)</Label>
              <Badge label="Nouveau" tone="success" />
            </View>
            {justGenerated.map((v) => (
              <View
                key={v.id}
                style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}
              >
                <TicketQr code={v.code} />
                <Text
                  style={{
                    flex: 1,
                    color: theme.text,
                    fontFamily: theme.mono,
                    fontSize: 18,
                    letterSpacing: 1,
                  }}
                >
                  {v.code}
                </Text>
              </View>
            ))}
            <Button
              title="Imprimer les tickets (PDF)"
              onPress={() => printBatch(justGenerated)}
              loading={printBusy}
            />
            <Button
              title="Partager tous les codes"
              variant="ghost"
              onPress={() => shareCodes(justGenerated)}
            />
          </Card>
        ) : null}

        {batchesQuery.data?.length ? (
          <View style={{ gap: 12 }}>
            <Label>Lots générés (réimpression)</Label>
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

        <Label>Codes existants</Label>
        {vouchersQuery.isLoading ? (
          <Subtitle>Chargement…</Subtitle>
        ) : !vouchersQuery.data?.length ? (
          <Empty text="Aucun code pour ce routeur." />
        ) : (
          vouchersQuery.data.map((v) => (
            <Card key={v.id}>
              <View
                style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}
              >
                <TicketQr code={v.code} size={56} />
                <Text
                  style={{
                    flex: 1,
                    color: theme.text,
                    fontFamily: theme.mono,
                    fontSize: 15,
                    letterSpacing: 1,
                  }}
                >
                  {v.code}
                </Text>
                <Badge label={v.status} tone={STATUS_TONE[v.status]} />
              </View>
              <View style={{ flexDirection: 'row', gap: 12 }}>
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
            </Card>
          ))
        )}
      </ScrollView>
      <BottomNav active="tickets" />
    </View>
  );
}
