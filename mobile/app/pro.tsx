import { useState } from 'react';
import { ScrollView, View, Text, Pressable } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { api, extractErrorMessage } from '@/src/lib/api';
import {
  Badge,
  Banner,
  Button,
  Card,
  Row,
  Subtitle,
  theme,
  Title,
} from '@/src/components/ui';

type Tier = {
  key: string;
  name: string;
  monthly: number;
  tagline: string;
  featured?: boolean;
  vip?: boolean;
  features: string[];
  locked?: string[];
};

const TIERS: Tier[] = [
  {
    key: 'essentiel',
    name: 'Essentiel',
    monthly: 4000,
    tagline: '3 routeurs',
    features: [
      'Jusqu’à 3 routeurs MikroTik',
      'Génération de tickets illimitée',
      'Impression thermique Bluetooth',
      'Templates de tickets basiques',
    ],
    locked: ['Sauvegarde Cloud automatique', 'Accès distant VPN multi-sites'],
  },
  {
    key: 'avance',
    name: 'Avancé',
    monthly: 12000,
    tagline: '10 routeurs',
    featured: true,
    features: [
      'Jusqu’à 10 routeurs MikroTik',
      'Tickets illimités',
      'Impression thermique + PDF A4/A3',
      'Tous les templates Premium',
      'Sauvegarde Cloud automatique 24/7',
      'Accès distant VPN multi-sites',
    ],
  },
  {
    key: 'entreprise',
    name: 'Entreprise',
    monthly: 28000,
    tagline: 'Routeurs illimités',
    vip: true,
    features: [
      'Routeurs MikroTik illimités',
      'Tickets & baux DHCP illimités',
      'Support technique dédié 24/7',
      'Personnalisation illimitée',
    ],
  },
];

function fmt(n: number): string {
  return n.toLocaleString('fr-FR');
}

export default function ProScreen() {
  const [annual, setAnnual] = useState(false);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [result, setResult] = useState<
    { tone: 'success' | 'danger'; text: string } | null
  >(null);

  async function choose(tier: Tier) {
    setBusyKey(tier.key);
    setResult(null);
    try {
      const res = await api.subscriptions.requestUpgrade(
        `${tier.name}${annual ? ' (annuel)' : ' (mensuel)'}`,
      );
      setResult({ tone: 'success', text: res.instructions });
    } catch (e) {
      setResult({ tone: 'danger', text: extractErrorMessage(e) });
    } finally {
      setBusyKey(null);
    }
  }

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: theme.bg }}
      contentContainerStyle={{ padding: 16, gap: 16, paddingBottom: 40 }}
    >
      <View style={{ alignItems: 'center', gap: 8 }}>
        <View
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            gap: 6,
            backgroundColor: theme.gold + '22',
            borderRadius: 999,
            paddingHorizontal: 12,
            paddingVertical: 5,
          }}
        >
          <Ionicons name="ribbon" size={15} color={theme.gold} />
          <Text style={{ color: theme.gold, fontWeight: '800', fontSize: 12 }}>
            MIKROLAN2 PRO
          </Text>
        </View>
        <Title>Passez au niveau supérieur</Title>
        <Subtitle>
          Débloquez le multi-routeurs, l’impression A4 et le cloud.
        </Subtitle>
      </View>

      {/* Billing toggle */}
      <Row
        style={{
          justifyContent: 'center',
          gap: 8,
          backgroundColor: theme.surface,
          borderRadius: 999,
          borderWidth: 1,
          borderColor: theme.border,
          padding: 4,
          alignSelf: 'center',
        }}
      >
        {(['Mensuel', 'Annuel'] as const).map((lbl) => {
          const active = (lbl === 'Annuel') === annual;
          return (
            <Pressable
              key={lbl}
              onPress={() => setAnnual(lbl === 'Annuel')}
              style={{
                borderRadius: 999,
                paddingHorizontal: 18,
                paddingVertical: 8,
                backgroundColor: active ? theme.primary : 'transparent',
                flexDirection: 'row',
                alignItems: 'center',
                gap: 6,
              }}
            >
              <Text
                style={{
                  color: active ? theme.primaryText : theme.textMuted,
                  fontWeight: '700',
                }}
              >
                {lbl}
              </Text>
              {lbl === 'Annuel' ? (
                <View
                  style={{
                    backgroundColor: active ? '#00000022' : theme.gold + '22',
                    borderRadius: 999,
                    paddingHorizontal: 6,
                    paddingVertical: 1,
                  }}
                >
                  <Text
                    style={{
                      color: active ? theme.primaryText : theme.gold,
                      fontSize: 10,
                      fontWeight: '800',
                    }}
                  >
                    -20%
                  </Text>
                </View>
              ) : null}
            </Pressable>
          );
        })}
      </Row>

      {result ? <Banner tone={result.tone}>{result.text}</Banner> : null}

      {TIERS.map((tier) => {
        const perMonth = annual ? Math.round(tier.monthly * 0.8) : tier.monthly;
        return (
          <Card
            key={tier.key}
            style={{
              borderColor: tier.featured ? theme.gold : theme.border,
              borderWidth: tier.featured ? 1.5 : 1,
            }}
          >
            <Row>
              <View>
                <Row style={{ gap: 8, justifyContent: 'flex-start' }}>
                  <Text style={{ color: theme.text, fontSize: 18, fontWeight: '800' }}>
                    {tier.name}
                  </Text>
                  {tier.featured ? <Badge label="Populaire" tone="gold" /> : null}
                  {tier.vip ? <Badge label="PRO VIP" tone="gold" /> : null}
                </Row>
                <Text style={{ color: theme.textMuted, fontSize: 12, marginTop: 2 }}>
                  {tier.tagline}
                </Text>
              </View>
              <View style={{ alignItems: 'flex-end' }}>
                <Text style={{ color: theme.text, fontSize: 20, fontWeight: '800' }}>
                  {fmt(perMonth)}
                </Text>
                <Text style={{ color: theme.textMuted, fontSize: 11 }}>FCFA / mois</Text>
              </View>
            </Row>

            <View style={{ gap: 8, marginTop: 4 }}>
              {tier.features.map((f) => (
                <Row key={f} style={{ justifyContent: 'flex-start', gap: 8 }}>
                  <Ionicons name="checkmark-circle" size={17} color={theme.success} />
                  <Text style={{ color: theme.text, fontSize: 13.5, flex: 1 }}>{f}</Text>
                </Row>
              ))}
              {tier.locked?.map((f) => (
                <Row key={f} style={{ justifyContent: 'flex-start', gap: 8 }}>
                  <Ionicons name="lock-closed" size={16} color={theme.textMuted} />
                  <Text
                    style={{
                      color: theme.textMuted,
                      fontSize: 13.5,
                      flex: 1,
                      textDecorationLine: 'line-through',
                    }}
                  >
                    {f}
                  </Text>
                </Row>
              ))}
            </View>

            <Button
              title={`Choisir ${tier.name}`}
              variant={tier.featured ? 'gold' : 'ghost'}
              onPress={() => choose(tier)}
              loading={busyKey === tier.key}
            />
          </Card>
        );
      })}

      <Text style={{ color: theme.textMuted, fontSize: 12, textAlign: 'center' }}>
        Paiement Mobile Money (Wave / Orange). Sans engagement.
      </Text>
    </ScrollView>
  );
}
