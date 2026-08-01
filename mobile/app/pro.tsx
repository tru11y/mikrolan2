import { useState } from 'react';
import { ScrollView, View, Text, Pressable } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { api, extractErrorMessage } from '@/src/lib/api';
import { Banner, Button, Row, Subtitle, theme, Title } from '@/src/components/ui';

type TierKey = 'essentiel' | 'avance' | 'entreprise';

type Tier = {
  key: TierKey;
  name: string;
  monthly: number;
  tagline: string;
  badge?: string;
  featured?: boolean;
  features: { label: string; included: boolean }[];
};

const TIERS: Tier[] = [
  {
    key: 'essentiel',
    name: 'Essentiel',
    monthly: 5000,
    tagline: '3 routeurs',
    features: [
      { label: 'Jusqu’à 3 routeurs MikroTik', included: true },
      { label: 'Génération de tickets illimitée', included: true },
      { label: 'Impression thermique Bluetooth', included: true },
      { label: 'Templates de tickets basiques', included: true },
      { label: 'Sauvegarde Cloud automatique', included: false },
      { label: 'Accès distant multi-sites', included: false },
    ],
  },
  {
    key: 'avance',
    name: 'Avancé',
    monthly: 15000,
    tagline: '10 routeurs',
    badge: 'MEILLEURE OFFRE',
    featured: true,
    features: [
      { label: 'Jusqu’à 10 routeurs MikroTik', included: true },
      { label: 'Génération de tickets illimitée', included: true },
      { label: 'Impression thermique + PDF A4/A3', included: true },
      { label: 'Tous les templates Premium', included: true },
      { label: 'Sauvegarde Cloud automatique 24/7', included: true },
      { label: 'Accès distant multi-sites', included: true },
    ],
  },
  {
    key: 'entreprise',
    name: 'Entreprise',
    monthly: 35000,
    tagline: 'Routeurs illimités',
    badge: 'PRO VIP',
    features: [
      { label: 'Routeurs MikroTik illimités', included: true },
      { label: 'Tickets & baux DHCP illimités', included: true },
      { label: 'Support technique dédié 24/7', included: true },
      { label: 'Personnalisation white-label', included: true },
      { label: 'Sauvegarde Cloud & API', included: true },
      { label: 'Accès distant multi-sites', included: true },
    ],
  },
];

function fmt(n: number): string {
  return n.toLocaleString('fr-FR');
}

export default function ProScreen() {
  const [annual, setAnnual] = useState(true);
  const [selected, setSelected] = useState<TierKey>('avance');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<
    { tone: 'success' | 'danger'; text: string } | null
  >(null);

  const tier = TIERS.find((t) => t.key === selected)!;

  async function buy() {
    setBusy(true);
    setResult(null);
    try {
      const res = await api.subscriptions.requestUpgrade(
        `${tier.name}${annual ? ' (annuel)' : ' (mensuel)'}`,
      );
      setResult({ tone: 'success', text: res.instructions });
    } catch (e) {
      setResult({ tone: 'danger', text: extractErrorMessage(e) });
    } finally {
      setBusy(false);
    }
  }

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: theme.bg }}
      contentContainerStyle={{ padding: 16, gap: 20, paddingBottom: 40 }}
    >
      {/* Header */}
      <View style={{ alignItems: 'center', gap: 6 }}>
        <View
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            gap: 6,
            backgroundColor: theme.gold + '22',
            borderWidth: 1,
            borderColor: theme.gold + '66',
            borderRadius: 999,
            paddingHorizontal: 12,
            paddingVertical: 5,
          }}
        >
          <Ionicons name="ribbon" size={16} color={theme.gold} />
          <Text
            style={{
              color: theme.gold,
              fontWeight: '800',
              fontSize: 11,
              letterSpacing: 0.5,
              textTransform: 'uppercase',
            }}
          >
            MikroLan2 Prime
          </Text>
        </View>
        <Title>Passez au niveau supérieur</Title>
        <Subtitle>
          Débloquez le multi-routeurs, l’impression A4 et le cloud
        </Subtitle>
      </View>

      {/* Billing toggle */}
      <Row style={{ alignSelf: 'center' }}>
        <View
          style={{
            flexDirection: 'row',
            gap: 4,
            backgroundColor: theme.surface,
            borderWidth: 1,
            borderColor: theme.border,
            borderRadius: 16,
            padding: 6,
          }}
        >
          <Pressable
            onPress={() => setAnnual(false)}
            style={{
              borderRadius: 12,
              paddingHorizontal: 18,
              paddingVertical: 9,
              backgroundColor: !annual ? theme.surfaceAlt : 'transparent',
              borderWidth: !annual ? 1 : 0,
              borderColor: theme.border,
            }}
          >
            <Text
              style={{
                color: !annual ? theme.text : theme.textMuted,
                fontWeight: '700',
                fontSize: 12,
              }}
            >
              Mensuel
            </Text>
          </Pressable>
          <Pressable
            onPress={() => setAnnual(true)}
            style={{
              borderRadius: 12,
              paddingHorizontal: 18,
              paddingVertical: 9,
              backgroundColor: annual ? theme.primary : 'transparent',
              flexDirection: 'row',
              alignItems: 'center',
              gap: 6,
            }}
          >
            <Text
              style={{
                color: annual ? theme.primaryText : theme.textMuted,
                fontWeight: '700',
                fontSize: 12,
              }}
            >
              Annuel
            </Text>
            <View
              style={{
                backgroundColor: annual ? '#00000022' : theme.gold + '22',
                borderRadius: 999,
                paddingHorizontal: 6,
                paddingVertical: 1,
              }}
            >
              <Text
                style={{
                  color: annual ? theme.primaryText : theme.gold,
                  fontSize: 9,
                  fontWeight: '800',
                }}
              >
                -20%
              </Text>
            </View>
          </Pressable>
        </View>
      </Row>

      {result ? <Banner tone={result.tone}>{result.text}</Banner> : null}

      {/* Plan cards (tap to select) */}
      <View style={{ gap: 16 }}>
        {TIERS.map((t) => {
          const perMonth = annual ? Math.round(t.monthly * 0.8) : t.monthly;
          const isSelected = t.key === selected;
          const borderColor = t.featured
            ? theme.gold
            : isSelected
              ? theme.primary
              : theme.border;

          return (
            <Pressable key={t.key} onPress={() => setSelected(t.key)}>
              <View
                style={{
                  borderRadius: 16,
                  borderWidth: 2,
                  borderColor,
                  backgroundColor: theme.surface,
                  padding: 20,
                  overflow: 'hidden',
                }}
              >
                {t.badge ? (
                  <View
                    style={{
                      position: 'absolute',
                      top: 0,
                      right: 0,
                      backgroundColor: theme.gold,
                      borderBottomLeftRadius: 12,
                      paddingHorizontal: 12,
                      paddingVertical: 4,
                    }}
                  >
                    <Text
                      style={{
                        color: theme.goldText,
                        fontSize: 10,
                        fontWeight: '800',
                        letterSpacing: 0.5,
                      }}
                    >
                      {t.badge}
                    </Text>
                  </View>
                ) : null}

                <Row>
                  <View>
                    <Text
                      style={{ color: theme.text, fontSize: 18, fontWeight: '800' }}
                    >
                      {t.name}
                    </Text>
                    <Text
                      style={{ color: theme.textMuted, fontSize: 12, marginTop: 2 }}
                    >
                      {t.tagline}
                    </Text>
                  </View>
                  <View style={{ alignItems: 'flex-end' }}>
                    <Text
                      style={{ color: theme.text, fontSize: 20, fontWeight: '800' }}
                    >
                      {fmt(perMonth)} F
                    </Text>
                    <Text style={{ color: theme.textMuted, fontSize: 10 }}>
                      / mois
                    </Text>
                  </View>
                </Row>

                <View
                  style={{
                    gap: 8,
                    marginTop: 16,
                    paddingTop: 12,
                    borderTopWidth: 1,
                    borderTopColor: theme.border,
                  }}
                >
                  {t.features.map((f) => (
                    <Row
                      key={f.label}
                      style={{ justifyContent: 'flex-start', gap: 8 }}
                    >
                      <Ionicons
                        name={f.included ? 'checkmark' : 'lock-closed'}
                        size={f.included ? 16 : 14}
                        color={f.included ? theme.success : theme.textMuted}
                      />
                      <Text
                        style={{
                          color: f.included ? theme.text : theme.textMuted,
                          fontSize: 12,
                          flex: 1,
                          textDecorationLine: f.included ? 'none' : 'line-through',
                          opacity: f.included ? 1 : 0.6,
                        }}
                      >
                        {f.label}
                      </Text>
                    </Row>
                  ))}
                </View>
              </View>
            </Pressable>
          );
        })}
      </View>

      <Button
        title={`Demander l'activation ${tier.name}`}
        variant="gold"
        onPress={buy}
        loading={busy}
      />

      <Text style={{ color: theme.textMuted, fontSize: 12, textAlign: 'center' }}>
        Un administrateur validera votre paiement Wave / Orange Money sous 24h. Sans engagement.
      </Text>
    </ScrollView>
  );
}
