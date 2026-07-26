import { useState } from 'react';
import { ScrollView, Share, Text, View } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  api,
  extractErrorMessage,
  type VoucherBatch,
  type VoucherItem,
} from '@/src/lib/api';
import { printTickets } from '@/src/lib/ticketsPdf';
import { TicketCard } from '@/src/components/TicketCard';
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

function fmtDuration(min: number): string {
  if (min % 1440 === 0) return `${min / 1440}j`;
  if (min % 60 === 0) return `${min / 60}h`;
  return `${min}min`;
}

export default function FichiersScreen() {
  const { routerId } = useLocalSearchParams<{ routerId: string }>();
  const qc = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const [reprintId, setReprintId] = useState<string | null>(null);

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
        template: r?.ticketTemplate,
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
        <View>
          <Text style={{ color: theme.text, fontSize: 20, fontWeight: '700' }}>
            Fichiers & Impression
          </Text>
          <Text style={{ color: theme.textMuted, fontSize: 12, marginTop: 2 }}>
            Historique des lots générés et codes existants pour ce routeur
          </Text>
        </View>

        {error ? <Banner tone="danger">{error}</Banner> : null}

        <View style={{ gap: 12 }}>
          <Text style={{ color: theme.text, fontSize: 14, fontWeight: '700' }}>
            Lots générés (réimpression)
          </Text>
          {!batchesQuery.data?.length ? (
            <Empty text="Aucun lot généré pour ce routeur." />
          ) : (
            batchesQuery.data.map((b) => (
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
            ))
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
                  </View>
                </View>
              );
            })}
          </View>
        )}
      </ScrollView>
      <BottomNav active="fichiers" />
    </View>
  );
}
