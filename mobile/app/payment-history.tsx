export { ScreenErrorBoundary as ErrorBoundary } from '@/src/components/ScreenErrorBoundary';
import { View, Text, FlatList, Pressable } from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTheme } from '@/src/providers/theme-provider';
import { api, type InvoiceHistoryItem } from '@/src/lib/api';

const STATUS_COLORS: Record<string, string> = {
  PAID: '#22c55e',
  PENDING: '#f59e0b',
  FAILED: '#ef4444',
  REFUNDED: '#6b7280',
};

const STATUS_LABELS: Record<string, string> = {
  PAID: 'Payée',
  PENDING: 'En attente',
  FAILED: 'Échouée',
  REFUNDED: 'Remboursée',
};

function InvoiceRow({ item }: { item: InvoiceHistoryItem }) {
  const theme = useTheme();
  const date = new Date(item.createdAt).toLocaleDateString('fr-FR', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });

  return (
    <View
      style={{
        backgroundColor: theme.surface,
        borderRadius: 12,
        padding: 16,
        marginBottom: 10,
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
      }}
    >
      <View style={{ flex: 1 }}>
        <Text style={{ color: theme.text, fontWeight: '600', fontSize: 15 }}>
          {item.tier?.name ?? 'Facture'}
        </Text>
        <Text style={{ color: theme.textMuted, fontSize: 12, marginTop: 2 }}>
          {date} · {item.billingPeriod === 'ANNUAL' ? 'Annuel' : 'Mensuel'}
        </Text>
      </View>
      <View style={{ alignItems: 'flex-end' }}>
        <Text style={{ color: theme.text, fontWeight: '700', fontSize: 15 }}>
          {item.amount.toLocaleString('fr-FR')} {item.currency}
        </Text>
        <View
          style={{
            backgroundColor: STATUS_COLORS[item.status] + '22',
            borderRadius: 6,
            paddingHorizontal: 8,
            paddingVertical: 2,
            marginTop: 4,
          }}
        >
          <Text
            style={{
              color: STATUS_COLORS[item.status],
              fontSize: 11,
              fontWeight: '600',
            }}
          >
            {STATUS_LABELS[item.status] ?? item.status}
          </Text>
        </View>
      </View>
    </View>
  );
}

export default function PaymentHistoryScreen() {
  const theme = useTheme();
  const router = useRouter();
  const { t } = useTranslation();

  const { data, isLoading, refetch } = useQuery({
    queryKey: ['invoice-history'],
    queryFn: () => api.subscriptions.invoiceHistory(),
  });

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: theme.bg }}>
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          padding: 16,
          gap: 12,
        }}
      >
        <Pressable onPress={() => router.back()}>
          <Ionicons name="arrow-back" size={24} color={theme.text} />
        </Pressable>
        <Text style={{ color: theme.text, fontSize: 20, fontWeight: '700' }}>
          Historique des paiements
        </Text>
      </View>

      <FlatList
        data={data ?? []}
        keyExtractor={(item) => item.id}
        renderItem={({ item }) => <InvoiceRow item={item} />}
        contentContainerStyle={{ padding: 16, paddingTop: 0 }}
        refreshing={isLoading}
        onRefresh={refetch}
        ListEmptyComponent={
          !isLoading ? (
            <View style={{ alignItems: 'center', paddingTop: 60 }}>
              <Ionicons
                name="receipt-outline"
                size={48}
                color={theme.textMuted}
              />
              <Text
                style={{
                  color: theme.textMuted,
                  fontSize: 15,
                  marginTop: 12,
                }}
              >
                Aucune facture
              </Text>
            </View>
          ) : null
        }
      />
    </SafeAreaView>
  );
}
