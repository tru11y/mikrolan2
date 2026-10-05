export { ScreenErrorBoundary as ErrorBoundary } from '@/src/components/ScreenErrorBoundary';
import { useEffect, useState } from 'react';
import { ScrollView, Text, TextInput, View } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { api, type VoucherVerificationResult } from '@/src/lib/api';
import { reportSilent } from '@/src/lib/report';
import { describeError } from '@/src/lib/errors';
import { fmtDateFull } from '@/src/lib/format';
import { effectiveState, fmtDayTime, fmtPlanDuration, fmtRemaining, remainingMs, verdictSpec, type VerdictSpec } from '@/src/lib/ticketVerification';
import {
  Button,
  Card,
  Label,
  Mono,
  radius,
  Row,
  space,
  Subtitle,
  Title,
  type,
  weight,
  withAlpha,
  type IoniconName,
} from '@/src/components/ui';
import { useTheme } from '@/src/providers/theme-provider';
import { BottomNav, useBottomNavHeight } from '@/src/components/BottomNav';
import { AppHeader } from '@/src/components/AppHeader';

type Verdict = VerdictSpec & { result: VoucherVerificationResult; titleText: string; detailText: string };

/** JJ/MM/AAAA HH:MM:SS, format des dates de session de cet écran. */
function fmtDate(iso: string): string {
  return fmtDateFull(iso);
}

function fmtBytes(raw: string): string {
  const n = Number(raw);
  if (n < 1024) return `${n} o`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} Ko`;
  if (n < 1024 * 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} Mo`;
  return `${(n / (1024 * 1024 * 1024)).toFixed(2)} Go`;
}

function InfoRow({ label, value, color }: { label: string; value: string; color?: string }) {
  const theme = useTheme();
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
  const theme = useTheme();
  const { t } = useTranslation();
  const { routerId } = useLocalSearchParams<{ routerId: string }>();
  const navHeight = useBottomNavHeight();

  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [verdict, setVerdict] = useState<Verdict | null>(null);
  // Compteur local : mis à jour sans aucune requête réseau.
  const [nowMs, setNowMs] = useState(() => Date.now());
  const [clockOffsetMs, setClockOffsetMs] = useState(0);
  const [error, setError] = useState<string | null>(null);

  async function verify() {
    const wanted = code.trim();
    if (!wanted) return;
    setBusy(true);
    setError(null);
    setVerdict(null);
    try {
      const result = await api.vouchers.verify(wanted, undefined, routerId);
      const spec = verdictSpec(result.state);
      const serverMs = Date.parse(result.serverNow);
      setClockOffsetMs(Number.isNaN(serverMs) ? 0 : serverMs - Date.now());
      setNowMs(Date.now());
      setVerdict({ ...spec, titleText: t(`verifyTicket.${spec.title}`), detailText: t(`verifyTicket.${spec.detail}`), result });
    } catch (e) {
      const described = describeError(e);
      if (described.status === 401 || described.status === 404) {
        setVerdict({
          tone: 'invalid',
          icon: 'ban-outline',
          title: 'states.UNAVAILABLE',
          detail: 'stateDetails.UNAVAILABLE',
          titleText: t('verifyTicket.unknown'),
          detailText: t('verifyTicket.unknownDetail'),
          result: null as never,
        });
      } else {
        reportSilent('verify-ticket.verify', e, { routerId });
        setError(described.message);
      }
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    if (!verdict?.result) return;
    const id = setInterval(() => setNowMs(Date.now()), 30_000);
    return () => clearInterval(id);
  }, [verdict]);

  const toneColor: Record<Verdict['tone'], string> = {
    valid: theme.success,
    used: theme.warning,
    invalid: theme.danger,
  };
  const r = verdict?.result;
  const remaining = r ? remainingMs({ expiresAt: r.expiresAt, durationSeconds: r.durationSeconds, nowMs, clockOffsetMs }) : 0;
  const eff = r ? effectiveState(r.state, r.usedAt, remaining) : null;
  const shown: Verdict | null =
    verdict && r && eff && eff !== r.state
      ? { ...verdictSpec(eff), result: r, titleText: t(`verifyTicket.${verdictSpec(eff).title}`), detailText: t(`verifyTicket.${verdictSpec(eff).detail}`) }
      : verdict;
  const accent = shown ? toneColor[shown.tone] : theme.primary;
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
            title={t('verifyTicket.verify')}
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

        {shown ? (
          <Card style={{ gap: space.md, borderColor: withAlpha(accent, 0.5) }}>
            <Row style={{ gap: space.md, justifyContent: 'flex-start' }}>
              <View
                style={{
                  width: 48,
                  height: 48,
                  borderRadius: radius.lg,
                  backgroundColor: withAlpha(accent, 0.13),
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                <Ionicons name={shown.icon} size={26} color={accent} />
              </View>
              <View style={{ flex: 1 }}>
                <Text
                  style={{
                    color: accent,
                    fontSize: type.bodyLg,
                    fontWeight: weight.bold,
                  }}
                >
                  {shown.titleText}
                </Text>
                <Text
                  style={{
                    color: theme.textMuted,
                    fontSize: type.caption,
                    marginTop: 2,
                  }}
                >
                  {shown.detailText}
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
                <InfoRow label={t('verifyTicket.code')} value={r.code} />
                {r.routerName ? <InfoRow label={t('verifyTicket.router')} value={r.routerName} /> : null}
                <InfoRow
                  label={t('verifyTicket.plan')}
                  value={`${r.planName} · ${fmtPlanDuration(r.durationMinutes)} · ${r.priceXof.toLocaleString('fr-FR')} FCFA`}
                />
                {fmtDayTime(r.createdAt) ? <InfoRow label={t('verifyTicket.createdAt')} value={fmtDayTime(r.createdAt) as string} /> : null}
                <InfoRow
                  label={t('verifyTicket.firstConnection')}
                  value={fmtDayTime(r.usedAt) ?? t('verifyTicket.neverUsed')}
                />
                {eff !== 'REVOKED' && eff !== 'UNAVAILABLE' ? (
                  <>
                    <InfoRow
                      label={t('verifyTicket.expiresAt')}
                      value={r.expiresAt ? (fmtDayTime(r.expiresAt) ?? '—') : t('verifyTicket.afterFirstConnection')}
                    />
                    <InfoRow
                      label={t('verifyTicket.remaining')}
                      value={fmtRemaining(remaining, t('verifyTicket.expiredShort'))}
                      color={remaining <= 0 && r.expiresAt ? theme.danger : undefined}
                    />
                  </>
                ) : null}
                <InfoRow label={t('verifyTicket.state')} value={t(`verifyTicket.${shown.title}`)} />
                <InfoRow
                  label={t('verifyTicket.provisioning')}
                  value={r.provisioned ? t('verifyTicket.provisioned') : t('verifyTicket.notProvisioned')}
                  color={r.provisioned ? theme.success : theme.warning}
                />
                {r.source === 'LEGACY' ? (
                  <InfoRow label={t('verifyTicket.source')} value={t('verifyTicket.sourceLegacy')} color={theme.warning} />
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
                  {t('verifyTicket.session')}
                </Text>
                <InfoRow
                  label={t('verifyTicket.state')}
                  value={
                    s.status === 'ACTIVE'
                      ? t('verifyTicket.statusActive')
                      : s.status === 'TERMINATED'
                        ? t('verifyTicket.statusTerminated')
                        : t('verifyTicket.statusExpired')
                  }
                  color={s.status === 'ACTIVE' ? theme.success : theme.textMuted}
                />
                <InfoRow label={t('verifyTicket.start')} value={fmtDate(s.startedAt)} />
                {s.terminatedAt ? (
                  <InfoRow label={t('verifyTicket.end')} value={fmtDate(s.terminatedAt)} />
                ) : null}
                {s.lastSeenAt ? (
                  <InfoRow label={t('verifyTicket.lastActivity')} value={fmtDate(s.lastSeenAt)} />
                ) : null}
                <InfoRow label={t('verifyTicket.downloaded')} value={fmtBytes(s.bytesIn)} />
                <InfoRow label={t('verifyTicket.uploaded')} value={fmtBytes(s.bytesOut)} />
                {s.macAddress ? <InfoRow label={t('verifyTicket.mac')} value={s.macAddress} /> : null}
                {s.ipAddress ? <InfoRow label={t('verifyTicket.ip')} value={s.ipAddress} /> : null}
              </View>
            ) : null}

          </Card>
        ) : null}
      </ScrollView>
      <BottomNav active="tickets" />
    </View>
  );
}
