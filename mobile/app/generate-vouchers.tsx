import { useState } from 'react';
import { Pressable, ScrollView, Share, Text, View } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  api,
  extractErrorMessage,
  type Plan,
  type VoucherItem,
} from '@/src/lib/api';
import { getLocalCredentials } from '@/src/lib/router-credentials';
import { pushVouchersLan } from '@/src/services/mikrotik-lan/hotspotLan';
import { TicketQr } from '@/src/components/TicketQr';
import {
  Badge,
  Banner,
  Button,
  Card,
  Empty,
  Field,
  Label,
  Screen,
  Subtitle,
  Title,
  theme,
} from '@/src/components/ui';

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

  const plansQuery = useQuery({ queryKey: ['plans'], queryFn: api.plans.list });
  const vouchersQuery = useQuery({
    queryKey: ['vouchers', routerId],
    queryFn: () => api.routers.listVouchers(routerId),
    enabled: Boolean(routerId),
  });

  const [planId, setPlanId] = useState<string | null>(null);
  const [quantity, setQuantity] = useState('10');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [justGenerated, setJustGenerated] = useState<VoucherItem[] | null>(null);

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

  async function revoke(id: string) {
    try {
      await api.routers.revokeVoucher(routerId, id);
      await qc.invalidateQueries({ queryKey: ['vouchers', routerId] });
    } catch (e) {
      setError(extractErrorMessage(e));
    }
  }

  return (
    <Screen>
      <ScrollView contentContainerStyle={{ gap: 16 }}>
        <Title>Générer des codes</Title>
        <Subtitle>
          Choisissez un forfait, la quantité, puis distribuez les codes à vos
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
                  <Badge label={`${p.priceXof} F`} tone="gold" />
                </Pressable>
              );
            })
          )}
          <Field
            label="Quantité"
            value={quantity}
            onChangeText={setQuantity}
            keyboardType="number-pad"
          />
          <Button title="Générer" onPress={generate} loading={busy} />
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
              title="Partager tous les codes"
              onPress={() => shareCodes(justGenerated)}
            />
          </Card>
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
    </Screen>
  );
}
