import { useState } from 'react';
import { Image, Modal, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';
import { api, getApiBaseUrl, getAuthTokens, type PaymentProof } from '@/src/lib/api';
import { describeError } from '@/src/lib/errors';
import { shortDate } from '@/src/lib/format';
import { Button, Press, radius, Row, SkeletonCard, space, type } from '@/src/components/ui';
import { useTheme } from '@/src/providers/theme-provider';

const METHOD_LABEL: Record<PaymentProof['method'], string> = {
  WAVE: 'Wave',
  ORANGE_MONEY: 'Orange Money',
};

function proofSource(proofId: string) {
  const tokens = getAuthTokens();
  return {
    uri: `${getApiBaseUrl()}/subscriptions/proofs/${proofId}`,
    headers: (tokens ? { Authorization: `Bearer ${tokens.accessToken}` } : {}) as Record<string, string>,
  };
}

export function PaymentProofViewer({ invoiceId }: { invoiceId: string }) {
  const theme = useTheme();
  const [open, setOpen] = useState(false);
  const [zoomed, setZoomed] = useState<string | null>(null);
  const [failed, setFailed] = useState<Record<string, boolean>>({});

  const query = useQuery({
    queryKey: ['admin', 'invoice-proofs', invoiceId],
    queryFn: () => api.admin.invoiceProofs(invoiceId),
    enabled: open,
  });

  if (!open) {
    return <Button title="Voir la preuve de paiement" variant="ghost" onPress={() => setOpen(true)} />;
  }
  if (query.isLoading) return <SkeletonCard lines={2} />;
  if (query.isError) {
    return (
      <Text style={{ color: theme.danger, fontSize: type.caption }}>
        {describeError(query.error).message}
      </Text>
    );
  }

  const proofs = query.data ?? [];
  if (!proofs.length) {
    return (
      <Text style={{ color: theme.warning, fontSize: type.caption }}>
        Aucune preuve jointe à cette facture.
      </Text>
    );
  }

  return (
    <View style={{ gap: space.md }}>
      {proofs.map((p) => (
        <View key={p.id} style={{ gap: space.xs }}>
          <Text style={{ color: theme.textMuted, fontSize: type.micro }}>
            {METHOD_LABEL[p.method]} · {shortDate(p.createdAt)}
            {p.note ? ` · ${p.note}` : ''}
          </Text>
          {failed[p.id] ? (
            <Text style={{ color: theme.danger, fontSize: type.caption }}>
              Image indisponible (fichier introuvable ou format non affichable).
            </Text>
          ) : (
            <Press onPress={() => setZoomed(p.id)} accessibilityLabel="Agrandir la preuve">
              <Image
                source={proofSource(p.id)}
                resizeMode="contain"
                onError={() => setFailed((f) => ({ ...f, [p.id]: true }))}
                style={{ width: '100%', height: 220, borderRadius: radius.md, backgroundColor: theme.surfaceAlt }}
              />
            </Press>
          )}
        </View>
      ))}

      <Modal visible={zoomed !== null} transparent animationType="fade" onRequestClose={() => setZoomed(null)}>
        <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.92)', justifyContent: 'center' }}>
          <Row style={{ justifyContent: 'flex-end', padding: space.lg, position: 'absolute', top: 24, right: 0, zIndex: 2 }}>
            <Press onPress={() => setZoomed(null)} accessibilityLabel="Fermer">
              <Ionicons name="close" size={28} color="#fff" />
            </Press>
          </Row>
          {zoomed ? (
            <Image source={proofSource(zoomed)} resizeMode="contain" style={{ width: '100%', height: '85%' }} />
          ) : null}
        </View>
      </Modal>
    </View>
  );
}
