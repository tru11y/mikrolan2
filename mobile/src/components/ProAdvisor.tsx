import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Modal, ScrollView, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import {
  ScriptedAdvisor,
  type AdvisorChoice,
  type AdvisorEngine,
  type AdvisorTurn,
} from '@/src/lib/proAdvisor';
import type { Tier } from '@/src/config/tiers';
import {
  Button,
  FadeIn,
  IconChip,
  Press,
  radius,
  Row,
  space,
  type,
  withAlpha,
} from '@/src/components/ui';
import { useTheme } from '@/src/providers/theme-provider';

type Bubble = { id: number; from: 'bot' | 'me'; text: string };

/**
 * Accompagnement au moment de « Passer à PRO ».
 *
 * Le client arrivait sur une grille de trois prix sans savoir laquelle le
 * concernait, et abandonnait. Ici il répond à trois questions, obtient une
 * recommandation motivée, peut soulever ses objections habituelles (le prix,
 * l'engagement, le mode de paiement), et sa demande part avec le résumé de
 * l'échange pour l'administrateur qui l'activera.
 */
export function ProAdvisor({
  visible,
  tiers,
  onClose,
  onAccept,
}: {
  visible: boolean;
  /** Grille publiée : le conseiller raisonne dessus, pas sur une copie figée. */
  tiers: Tier[];
  onClose: () => void;
  /** L'utilisateur retient la formule conseillée : l'écran PRO prend la main. */
  onAccept: (tierKey: string, note: string) => void;
}) {
  const theme = useTheme();
  const engineRef = useRef<AdvisorEngine>(new ScriptedAdvisor(tiers));
  const scrollRef = useRef<ScrollView>(null);
  const nextId = useRef(0);

  const [bubbles, setBubbles] = useState<Bubble[]>([]);
  const [choices, setChoices] = useState<AdvisorChoice[]>([]);
  const [turn, setTurn] = useState<AdvisorTurn | null>(null);

  const applyTurn = useCallback((next: AdvisorTurn) => {
    setBubbles((prev) => [
      ...prev,
      ...next.say.map((text) => ({ id: nextId.current++, from: 'bot' as const, text })),
    ]);
    setChoices(next.choices);
    setTurn(next);
  }, []);

  const reset = useCallback(() => {
    engineRef.current = new ScriptedAdvisor(tiers);
    nextId.current = 0;
    setBubbles([]);
    setTurn(null);
    applyTurn(engineRef.current.start());
  }, [applyTurn, tiers]);

  // Le parcours repart de zéro à chaque ouverture : reprendre une conversation
  // à moitié faite, plusieurs jours plus tard, n'a aucun sens.
  useEffect(() => {
    if (visible) reset();
  }, [reset, visible]);

  function pick(choice: AdvisorChoice) {
    if (choice.id === 'restart') {
      reset();
      return;
    }
    setBubbles((prev) => [
      ...prev,
      { id: nextId.current++, from: 'me', text: choice.label },
    ]);
    setChoices([]);
    applyTurn(engineRef.current.answer(choice.id));
  }

  const recommended = turn?.recommendation ?? null;
  const tier = useMemo(
    () => tiers.find((t) => t.key === recommended) ?? null,
    [recommended, tiers],
  );

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={onClose}
    >
      <View style={{ flex: 1, backgroundColor: theme.bg }}>
        <Row
          style={{
            paddingHorizontal: space.lg,
            paddingTop: space.xl,
            paddingBottom: space.md,
            borderBottomWidth: 0,
            borderBottomColor: theme.border,
            gap: space.md,
          }}
        >
          <IconChip name="chatbubbles-outline" color={theme.primary} size="md" outlined />
          <View style={{ flex: 1 }}>
            <Text style={{ color: theme.text, fontSize: type.title, fontWeight: '700' }}>
              Conseiller MikroLan
            </Text>
            <Text style={{ color: theme.textMuted, fontSize: type.micro }}>
              Trouve la formule adaptée à votre activité
            </Text>
          </View>
          <Press accessibilityLabel="Fermer le conseiller" onPress={onClose} scaleTo={0.85}>
            <Ionicons name="close" size={24} color={theme.textMuted} />
          </Press>
        </Row>

        <ScrollView
          ref={scrollRef}
          contentContainerStyle={{ padding: space.lg, gap: space.md }}
          onContentSizeChange={() => scrollRef.current?.scrollToEnd({ animated: true })}
        >
          {bubbles.map((b) => (
            <FadeIn key={b.id} from={8}>
              <View
                style={{
                  alignSelf: b.from === 'bot' ? 'flex-start' : 'flex-end',
                  maxWidth: '86%',
                  backgroundColor: b.from === 'bot' ? theme.surface : theme.primary,
                  borderWidth: 0,
                  borderColor: theme.border,
                  borderRadius: radius.lg,
                  borderBottomLeftRadius: b.from === 'bot' ? radius.xs : radius.lg,
                  borderBottomRightRadius: b.from === 'bot' ? radius.lg : radius.xs,
                  paddingVertical: space.md,
                  paddingHorizontal: space.lg - 2,
                }}
              >
                <Text
                  style={{
                    color: b.from === 'bot' ? theme.text : theme.primaryText,
                    fontSize: type.body,
                    lineHeight: 20,
                    fontWeight: b.from === 'bot' ? '400' : '600',
                  }}
                >
                  {b.text}
                </Text>
              </View>
            </FadeIn>
          ))}
        </ScrollView>

        <View
          style={{
            padding: space.lg,
            gap: space.sm,
            borderTopWidth: 0,
            borderTopColor: theme.border,
            backgroundColor: theme.surface,
          }}
        >
          {choices.map((c, i) => (
            <FadeIn key={c.id} delay={i * 45} from={6}>
              <Press
                accessibilityLabel={c.label}
                onPress={() => pick(c)}
                style={{
                  ...(c.primary ? { borderWidth: 1, borderColor: theme.primary } : {}),
                  backgroundColor: c.primary ? withAlpha(theme.primary, 0.1) : theme.surfaceAlt,
                  borderRadius: radius.md,
                  paddingVertical: space.md,
                  paddingHorizontal: space.lg,
                }}
              >
                <Text
                  style={{
                    color: c.primary ? theme.primary : theme.text,
                    fontSize: type.body,
                    fontWeight: '600',
                  }}
                >
                  {c.label}
                </Text>
              </Press>
            </FadeIn>
          ))}

          {tier && turn?.requestNote ? (
            <FadeIn>
              <Button
                title={`Choisir la formule ${tier.name}`}
                variant="gold"
                onPress={() => onAccept(tier.key, turn.requestNote as string)}
              />
            </FadeIn>
          ) : null}
        </View>
      </View>
    </Modal>
  );
}
