import { useState } from 'react';
import { ScrollView, Text, TextInput, View } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { api, type VoucherItem, type VoucherLookupResult } from '@/src/lib/api';
import { describeError } from '@/src/lib/errors';
import {
  Button,
  Card,
  Label,
  Mono,
  radius,
  Row,
  space,
  Subtitle,
  theme,
  Title,
  type,
  weight,
  withAlpha,
  type IoniconName,
} from '@/src/components/ui';
import { BottomNav, useBottomNavHeight } from '@/src/components/BottomNav';
import { AppHeader } from '@/src/components/AppHeader';

/**
 * Vérification d'un code présenté par un client.
 *
 * Le gérant tape le code que le client lui montre et voit immédiatement s'il
 * est authentique et encore valable. Sans ça, un client peut présenter un code
 * inventé, déjà consommé ou révoqué : le gérant n'a aucun moyen de trancher
 * autrement qu'en le laissant essayer de se connecter.
 */

type Verdict = {
  tone: 'valid' | 'used' | 'invalid';
  icon: IoniconName;
  title: string;
  detail: string;
  voucher?: VoucherItem;
  plan?: NonNullable<VoucherLookupResult['plan']>;
};

const TONE_COLOR: Record<Verdict['tone'], string> = {
  valid: theme.success,
  used: theme.warning,
  invalid: theme.danger,
};

function fmtDuration(min: number): string {
  if (min % 1440 === 0) return `${min / 1440} j`;
  if (min % 60 === 0) return `${min / 60} h`;
  return `${min} min`;
}

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleString('fr-FR');
}

/** Un code encore vendable : jamais utilisé, ni révoqué, ni expiré. */
function verdictFor(
  v: VoucherItem,
  plan?: NonNullable<VoucherLookupResult['plan']>,
): Verdict {
  const expired =
    v.status === 'EXPIRED' ||
    (v.expiresAt != null && new Date(v.expiresAt).getTime() < Date.now());

  if (v.status === 'REVOKED') {
    return {
      tone: 'invalid',
      icon: 'ban-outline',
      title: 'Ticket annulé',
      detail: 'Ce ticket a été révoqué. Ne pas accepter.',
      voucher: v,
      plan,
    };
  }
  if (expired) {
    return {
      tone: 'invalid',
      icon: 'time-outline',
      title: 'Ticket expiré',
      detail: v.expiresAt
        ? `Il a expiré le ${fmtDate(v.expiresAt)}.`
        : 'Sa durée de validité est dépassée.',
      voucher: v,
      plan,
    };
  }
  if (v.status === 'USED') {
    return {
      tone: 'used',
      icon: 'checkmark-done-outline',
      title: 'Ticket déjà consommé',
      detail: v.usedAt
        ? `Il a été utilisé le ${fmtDate(v.usedAt)}.`
        : 'Ce ticket a déjà servi.',
      voucher: v,
      plan,
    };
  }
  if (v.status === 'ACTIVE') {
    return {
      tone: 'used',
      icon: 'wifi-outline',
      title: 'Ticket en cours d’utilisation',
      detail: v.usedAt
        ? `Connexion démarrée le ${fmtDate(v.usedAt)}.`
        : 'Une connexion est déjà ouverte avec ce code.',
      voucher: v,
      plan,
    };
  }
  return {
    tone: 'valid',
    icon: 'shield-checkmark-outline',
    title: 'Ticket valide',
    detail: 'Ce ticket est authentique et n’a jamais été utilisé.',
    voucher: v,
    plan,
  };
}

export default function VerifyTicketScreen() {
  const { routerId } = useLocalSearchParams<{ routerId: string }>();
  const navHeight = useBottomNavHeight();

  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [verdict, setVerdict] = useState<Verdict | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function verify() {
    const wanted = code.trim();
    if (!wanted || !routerId) return;
    setBusy(true);
    setError(null);
    setVerdict(null);
    try {
      // Recherche unitaire côté serveur — contrairement à l'ancienne recherche
      // sur la liste des 500 derniers tickets, un ticket ancien reste trouvable.
      const found = await api.routers.lookupVoucher(routerId, wanted);
      setVerdict(verdictFor(found, found.plan ?? undefined));
    } catch (e) {
      const described = describeError(e);
      if (described.status === 404) {
        setVerdict({
          tone: 'invalid',
          icon: 'close-circle-outline',
          title: 'Ticket inconnu',
          detail:
            'Ce code n’a pas été émis pour ce routeur. Il peut être faux ou provenir d’un autre point de vente.',
        });
      } else {
        setError(described.message);
      }
    } finally {
      setBusy(false);
    }
  }

  const accent = verdict ? TONE_COLOR[verdict.tone] : theme.primary;

  return (
    <View style={{ flex: 1, backgroundColor: theme.bg }}>
      <AppHeader title="Vérifier un ticket" back />
      <ScrollView
        contentContainerStyle={{
          gap: space.lg,
          padding: space.lg,
          paddingBottom: navHeight,
        }}
      >
        <View>
          <Title>Vérifier un ticket</Title>
          <Subtitle>
            Saisissez le code présenté par le client pour confirmer qu&rsquo;il est
            authentique et encore valable.
          </Subtitle>
        </View>

        <Card style={{ gap: space.md }}>
          <Label>Code du ticket</Label>
          <Row style={{ gap: space.sm, alignItems: 'stretch' }}>
            <View
              style={{
                flex: 1,
                backgroundColor: theme.surfaceAlt,
                borderWidth: 1,
                borderColor: theme.border,
                borderRadius: radius.md,
                paddingHorizontal: space.md,
                justifyContent: 'center',
              }}
            >
              <TextInput
                value={code}
                onChangeText={(v) => {
                  setCode(v.replace(/\s/g, ''));
                  setVerdict(null);
                }}
                onSubmitEditing={verify}
                returnKeyType="search"
                autoCapitalize="characters"
                autoCorrect={false}
                placeholder="Ex. 1h4F9QXZ"
                placeholderTextColor={theme.textMuted}
                accessibilityLabel="Code du ticket à vérifier"
                style={{
                  color: theme.text,
                  fontFamily: theme.mono,
                  fontSize: type.bodyLg,
                  paddingVertical: space.md,
                  letterSpacing: 1,
                }}
              />
            </View>
          </Row>
          <Button
            title="Vérifier"
            onPress={verify}
            loading={busy}
            disabled={!code.trim() || !routerId}
          />
        </Card>

        {error ? (
          <Card style={{ borderColor: withAlpha(theme.danger, 0.4) }}>
            <Row style={{ gap: space.sm, justifyContent: 'flex-start' }}>
              <Ionicons name="cloud-offline-outline" size={20} color={theme.danger} />
              <Text style={{ color: theme.text, flex: 1, fontSize: type.body }}>
                {error}
              </Text>
            </Row>
          </Card>
        ) : null}

        {verdict ? (
          <Card style={{ gap: space.md, borderColor: withAlpha(accent, 0.5) }}>
            <Row style={{ gap: space.md, justifyContent: 'flex-start' }}>
              <View
                style={{
                  width: 48,
                  height: 48,
                  borderRadius: radius.lg,
                  backgroundColor: withAlpha(accent, 0.13),
                  borderWidth: 1,
                  borderColor: withAlpha(accent, 0.4),
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                <Ionicons name={verdict.icon} size={26} color={accent} />
              </View>
              <View style={{ flex: 1 }}>
                <Text
                  style={{
                    color: accent,
                    fontSize: type.bodyLg,
                    fontWeight: weight.bold,
                  }}
                >
                  {verdict.title}
                </Text>
                <Text
                  style={{
                    color: theme.textMuted,
                    fontSize: type.caption,
                    marginTop: 2,
                  }}
                >
                  {verdict.detail}
                </Text>
              </View>
            </Row>

            {verdict.voucher ? (
              <View
                style={{
                  gap: space.sm,
                  paddingTop: space.md,
                  borderTopWidth: 1,
                  borderTopColor: theme.border,
                }}
              >
                <Row>
                  <Text style={{ color: theme.textMuted, fontSize: type.caption }}>
                    Code
                  </Text>
                  <Mono style={{ color: theme.text, fontSize: type.caption }}>
                    {verdict.voucher.code}
                  </Mono>
                </Row>
                {verdict.plan ? (
                  <>
                    <Row>
                      <Text style={{ color: theme.textMuted, fontSize: type.caption }}>
                        Forfait
                      </Text>
                      <Text style={{ color: theme.text, fontSize: type.caption }}>
                        {verdict.plan.name}
                      </Text>
                    </Row>
                    <Row>
                      <Text style={{ color: theme.textMuted, fontSize: type.caption }}>
                        Durée
                      </Text>
                      <Text style={{ color: theme.text, fontSize: type.caption }}>
                        {fmtDuration(verdict.plan.durationMinutes)}
                      </Text>
                    </Row>
                    <Row>
                      <Text style={{ color: theme.textMuted, fontSize: type.caption }}>
                        Prix
                      </Text>
                      <Text
                        style={{
                          color: theme.success,
                          fontSize: type.caption,
                          fontWeight: weight.bold,
                        }}
                      >
                        {verdict.plan.priceXof.toLocaleString('fr-FR')} FCFA
                      </Text>
                    </Row>
                  </>
                ) : null}
                <Row>
                  <Text style={{ color: theme.textMuted, fontSize: type.caption }}>
                    Émis le
                  </Text>
                  <Text style={{ color: theme.text, fontSize: type.caption }}>
                    {fmtDate(verdict.voucher.createdAt)}
                  </Text>
                </Row>
              </View>
            ) : null}
          </Card>
        ) : null}
      </ScrollView>
      <BottomNav active="tickets" />
    </View>
  );
}
