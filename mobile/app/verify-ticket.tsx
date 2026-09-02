import { useState } from 'react';
import { ScrollView, Text, TextInput, View } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { api, type VoucherVerificationResult } from '@/src/lib/api';
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

type Verdict = {
  tone: 'valid' | 'used' | 'invalid';
  icon: IoniconName;
  title: string;
  detail: string;
  result: VoucherVerificationResult;
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

function fmtBytes(raw: string): string {
  const n = Number(raw);
  if (n < 1024) return `${n} o`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} Ko`;
  if (n < 1024 * 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} Mo`;
  return `${(n / (1024 * 1024 * 1024)).toFixed(2)} Go`;
}

function verdictFor(r: VoucherVerificationResult, t: (key: string, opts?: Record<string, unknown>) => string): Verdict {
  const expired =
    r.status === 'EXPIRED' ||
    (r.expiresAt != null && new Date(r.expiresAt).getTime() < Date.now());

  if (r.status === 'REVOKED') {
    return {
      tone: 'invalid',
      icon: 'ban-outline',
      title: t('verifyTicket.cancelled'),
      detail: t('verifyTicket.cancelledDetail'),
      result: r,
    };
  }
  if (expired) {
    return {
      tone: 'invalid',
      icon: 'time-outline',
      title: t('verifyTicket.expired'),
      detail: r.expiresAt
        ? t('verifyTicket.expiredAt', { date: fmtDate(r.expiresAt) })
        : t('verifyTicket.expiredGeneric'),
      result: r,
    };
  }
  if (r.status === 'USED') {
    return {
      tone: 'used',
      icon: 'checkmark-done-outline',
      title: t('verifyTicket.used'),
      detail: r.activatedAt
        ? t('verifyTicket.usedAt', { date: fmtDate(r.activatedAt) })
        : t('verifyTicket.usedGeneric'),
      result: r,
    };
  }
  if (r.status === 'ACTIVE') {
    return {
      tone: 'used',
      icon: 'wifi-outline',
      title: t('verifyTicket.inUse'),
      detail: r.activatedAt
        ? t('verifyTicket.inUseAt', { date: fmtDate(r.activatedAt) })
        : t('verifyTicket.inUseGeneric'),
      result: r,
    };
  }
  return {
    tone: 'valid',
    icon: 'shield-checkmark-outline',
    title: t('verifyTicket.valid'),
    detail: r.message || t('verifyTicket.validDetail'),
    result: r,
  };
}

function InfoRow({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <Row>
      <Text style={{ color: theme.textMuted, fontSize: type.caption }}>{label}</Text>
      <Text
        style={{
          color: color ?? theme.text,
          fontSize: type.caption,
          fontWeight: color ? weight.bold : weight.regular,
        }}
      >
        {value}
      </Text>
    </Row>
  );
}

export default function VerifyTicketScreen() {
  const { t } = useTranslation();
  const { routerId } = useLocalSearchParams<{ routerId: string }>();
  const navHeight = useBottomNavHeight();

  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [verdict, setVerdict] = useState<Verdict | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function verify() {
    const wanted = code.trim();
    if (!wanted) return;
    setBusy(true);
    setError(null);
    setVerdict(null);
    try {
      const result = await api.vouchers.verify(wanted, undefined, routerId);
      setVerdict(verdictFor(result, t));
    } catch (e) {
      const described = describeError(e);
      if (described.status === 401 || described.status === 404) {
        setVerdict({
          tone: 'invalid',
          icon: 'close-circle-outline',
          title: t('verifyTicket.unknown'),
          detail: t('verifyTicket.unknownDetail'),
          result: null as never,
        });
      } else {
        setError(described.message);
      }
    } finally {
      setBusy(false);
    }
  }

  const accent = verdict ? TONE_COLOR[verdict.tone] : theme.primary;
  const r = verdict?.result;
  const s = r?.session;

  return (
    <View style={{ flex: 1, backgroundColor: theme.bg }}>
      <AppHeader title={t('verifyTicket.title')} back />
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
            disabled={!code.trim()}
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

            {r ? (
              <View
                style={{
                  gap: space.sm,
                  paddingTop: space.md,
                  borderTopWidth: 1,
                  borderTopColor: theme.border,
                }}
              >
                <InfoRow label="Code" value={r.code} />
                <InfoRow label="Forfait" value={r.planName} />
                <InfoRow label="Durée" value={fmtDuration(r.durationMinutes)} />
                <InfoRow
                  label="Prix"
                  value={`${r.priceXof.toLocaleString('fr-FR')} FCFA`}
                  color={theme.success}
                />
                {r.routerName ? <InfoRow label="Routeur" value={r.routerName} /> : null}
                {r.source === 'LEGACY' ? (
                  <InfoRow label="Source" value="Legacy (routeur)" color={theme.warning} />
                ) : null}
                {r.deliveredAt ? (
                  <InfoRow label="Livré le" value={fmtDate(r.deliveredAt)} />
                ) : null}
                {r.activatedAt ? (
                  <InfoRow label="1re connexion" value={fmtDate(r.activatedAt)} />
                ) : null}
                {r.expiresAt ? (
                  <InfoRow label="Expire le" value={fmtDate(r.expiresAt)} />
                ) : null}
              </View>
            ) : null}

            {s ? (
              <View
                style={{
                  gap: space.sm,
                  paddingTop: space.md,
                  borderTopWidth: 1,
                  borderTopColor: theme.border,
                }}
              >
                <Text
                  style={{
                    color: theme.text,
                    fontSize: type.caption,
                    fontWeight: weight.bold,
                    marginBottom: 2,
                  }}
                >
                  Session
                </Text>
                <InfoRow
                  label="État"
                  value={
                    s.status === 'ACTIVE'
                      ? 'En cours'
                      : s.status === 'TERMINATED'
                        ? 'Terminée'
                        : 'Expirée'
                  }
                  color={s.status === 'ACTIVE' ? theme.success : theme.textMuted}
                />
                <InfoRow label="Début" value={fmtDate(s.startedAt)} />
                {s.terminatedAt ? (
                  <InfoRow label="Fin" value={fmtDate(s.terminatedAt)} />
                ) : null}
                {s.lastSeenAt ? (
                  <InfoRow label="Dernière activité" value={fmtDate(s.lastSeenAt)} />
                ) : null}
                <InfoRow label="Téléchargé" value={fmtBytes(s.bytesIn)} />
                <InfoRow label="Envoyé" value={fmtBytes(s.bytesOut)} />
                {s.macAddress ? <InfoRow label="MAC" value={s.macAddress} /> : null}
                {s.ipAddress ? <InfoRow label="IP" value={s.ipAddress} /> : null}
              </View>
            ) : null}

            {r?.advice ? (
              <Text
                style={{
                  color: theme.textMuted,
                  fontSize: type.caption,
                  fontStyle: 'italic',
                  paddingTop: space.sm,
                  borderTopWidth: 1,
                  borderTopColor: theme.border,
                }}
              >
                {r.advice}
              </Text>
            ) : null}
          </Card>
        ) : null}
      </ScrollView>
      <BottomNav active="tickets" />
    </View>
  );
}
