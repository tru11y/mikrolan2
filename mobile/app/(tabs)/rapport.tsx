import { useState } from 'react';
import { ScrollView, View, Text } from 'react-native';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/src/lib/api';
import {
  Card,
  Mono,
  Pill,
  Row,
  SectionTitle,
  Subtitle,
  theme,
  Title,
} from '@/src/components/ui';

const PERIODS = ['Aujourd’hui', '7 jours', '30 jours'] as const;

export default function RapportScreen() {
  const [period, setPeriod] = useState<(typeof PERIODS)[number]>('30 jours');
  const plans = useQuery({ queryKey: ['plans'], queryFn: api.plans.list });

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: theme.bg }}
      contentContainerStyle={{ padding: 16, gap: 16, paddingBottom: 32 }}
    >
      <View>
        <Title>Rapports & Revenus</Title>
        <Subtitle>Statistiques de vente de tickets WiFi</Subtitle>
      </View>

      <Row style={{ justifyContent: 'flex-start', gap: 8 }}>
        {PERIODS.map((p) => (
          <Pill
            key={p}
            label={p}
            active={p === period}
            onPress={() => setPeriod(p)}
          />
        ))}
      </Row>

      <Card>
        <Text style={{ color: theme.textMuted, fontSize: 12 }}>
          CHIFFRE D’AFFAIRES ({period})
        </Text>
        <Row style={{ alignItems: 'flex-end', marginTop: 4 }}>
          <Text style={{ color: theme.success, fontSize: 30, fontWeight: '800' }}>
            —
          </Text>
          <Text style={{ color: theme.textMuted, marginLeft: 6, marginBottom: 6 }}>
            FCFA
          </Text>
        </Row>
        <Text style={{ color: theme.textMuted, fontSize: 12 }}>
          Le suivi des revenus sera disponible avec le module de statistiques.
        </Text>
      </Card>

      <View>
        <SectionTitle>Répartition par forfait</SectionTitle>
        <Card>
          {(plans.data ?? []).length === 0 ? (
            <Text style={{ color: theme.textMuted }}>
              Aucun forfait défini pour le moment.
            </Text>
          ) : (
            <View style={{ gap: 12 }}>
              {(plans.data ?? []).map((p) => (
                <Row key={p.id}>
                  <Text style={{ color: theme.text }}>{p.name}</Text>
                  <Mono style={{ color: theme.textMuted }}>
                    {p.priceXof.toLocaleString('fr-FR')} FCFA
                  </Mono>
                </Row>
              ))}
            </View>
          )}
        </Card>
      </View>
    </ScrollView>
  );
}
