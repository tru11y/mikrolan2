export { ScreenErrorBoundary as ErrorBoundary } from '@/src/components/ScreenErrorBoundary';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  AppState,
  Linking,
  ScrollView,
  Text,
  View,
  type AppStateStatus,
} from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { Ionicons } from '@expo/vector-icons';
import { api, type BillingPeriod } from '@/src/lib/api';
import { describeError } from '@/src/lib/errors';
import { reportSilent } from '@/src/lib/report';
import { AppHeader } from '@/src/components/AppHeader';
import {
  Button,
  Row,
  Subtitle,
  Title,
  radius,
  space,
  type,
  useToast,
} from '@/src/components/ui';
import { useTheme } from '@/src/providers/theme-provider';

type IntentStatus = 'PENDING' | 'SUCCESS' | 'FAILED' | 'CANCELLED' | 'EXPIRED';

type Params = {
  tierKey?: string;
  tierName?: string;
  billingPeriod?: BillingPeriod;
};

// Poll parameters tuned for the SasPay webhook lifecycle:
// SasPay retries webhook delivery up to 5 times (immediate, +30s, +5m, +30m,
// +2h). The vast majority of successful payments show up within 30s. We poll
// aggressively for the first 2 minutes and then let the user confirm manually.
const POLL_INTERVAL_MS = 3_000;
const POLL_TIMEOUT_MS = 2 * 60_000;

export default function PaymentSaspayScreen() {
  const theme = useTheme();
  const { t } = useTranslation();
  const toast = useToast();
  const params = useLocalSearchParams<Params>();

  const tierKey = typeof params.tierKey === 'string' ? params.tierKey : null;
  const tierName = typeof params.tierName === 'string' ? params.tierName : null;
  const billingPeriod: BillingPeriod =
    params.billingPeriod === 'ANNUAL' ? 'ANNUAL' : 'MONTHLY';

  const [intentId, setIntentId] = useState<string | null>(null);
  const [checkoutUrl, setCheckoutUrl] = useState<string | null>(null);
  const [amount, setAmount] = useState<number | null>(null);
  const [status, setStatus] = useState<IntentStatus | null>(null);
  const [creating, setCreating] = useState(false);
  const [opening, setOpening] = useState(false);
  const [pollingSlow, setPollingSlow] = useState(false);

  const pollTimer = useRef<ReturnType<typeof setInterval> | null>(null);
  const slowTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const stoppedRef = useRef(false);

  const stopPolling = useCallback(() => {
    stoppedRef.current = true;
    if (pollTimer.current) {
      clearInterval(pollTimer.current);
      pollTimer.current = null;
    }
    if (slowTimer.current) {
      clearTimeout(slowTimer.current);
      slowTimer.current = null;
    }
  }, []);

  const checkOnce = useCallback(async (id: string) => {
    try {
      const intent = await api.saspay.getIntent(id);
      setStatus(intent.status);
      if (intent.status !== 'PENDING') {
        stopPolling();
      }
    } catch (err) {
      // On ne surface pas l'erreur en toast à chaque tick : seulement si
      // l'utilisateur a demandé une vérification manuelle (voir onCheckNow).
      reportSilent('saspay.intent.poll', err);
    }
  }, [stopPolling]);

  const startPolling = useCallback((id: string) => {
    stoppedRef.current = false;
    setPollingSlow(false);
    if (pollTimer.current) clearInterval(pollTimer.current);
    pollTimer.current = setInterval(() => {
      if (stoppedRef.current) return;
      void checkOnce(id);
    }, POLL_INTERVAL_MS);
    if (slowTimer.current) clearTimeout(slowTimer.current);
    slowTimer.current = setTimeout(() => {
      setPollingSlow(true);
      // On arrête le polling automatique après le timeout — l'utilisateur
      // peut toujours vérifier manuellement.
      if (pollTimer.current) {
        clearInterval(pollTimer.current);
        pollTimer.current = null;
      }
    }, POLL_TIMEOUT_MS);
  }, [checkOnce]);

  useEffect(() => () => stopPolling(), [stopPolling]);

  // Reprise après retour d'application : si l'app revient au premier plan
  // et qu'un paiement est en attente, on relance la vérification immédiate.
  useEffect(() => {
    const sub = AppState.addEventListener('change', (next: AppStateStatus) => {
      if (next === 'active' && intentId && status === 'PENDING') {
        void checkOnce(intentId);
        startPolling(intentId);
      }
    });
    return () => sub.remove();
  }, [intentId, status, checkOnce, startPolling]);

  const openCheckout = useCallback(async (url: string) => {
    setOpening(true);
    try {
      const ok = await Linking.canOpenURL(url);
      if (!ok) throw new Error('cannot open url');
      await Linking.openURL(url);
    } catch (err) {
      toast.show(t('saspay.openError'), 'danger');
      reportSilent('saspay.openUrl', err);
    } finally {
      setOpening(false);
    }
  }, [toast, t]);

  const onPay = useCallback(async () => {
    if (!tierKey) {
      toast.show(t('saspay.createError'), 'danger');
      return;
    }
    setCreating(true);
    try {
      const res = await api.saspay.createCheckout({ tierKey, billingPeriod });
      setIntentId(res.intentId);
      setCheckoutUrl(res.checkoutUrl);
      setAmount(res.amount);
      setStatus('PENDING');
      startPolling(res.intentId);
      await openCheckout(res.checkoutUrl);
    } catch (err) {
      toast.show(describeError(err).message, 'danger');
    } finally {
      setCreating(false);
    }
  }, [tierKey, billingPeriod, toast, t, startPolling, openCheckout]);

  const onCheckNow = useCallback(async () => {
    if (!intentId) return;
    try {
      const intent = await api.saspay.getIntent(intentId);
      setStatus(intent.status);
      if (intent.status === 'PENDING') {
        toast.show(t('saspay.waiting'), 'info');
      } else {
        stopPolling();
      }
    } catch (err) {
      toast.show(describeError(err).message, 'danger');
    }
  }, [intentId, toast, t, stopPolling]);

  const onRetry = useCallback(() => {
    stopPolling();
    setIntentId(null);
    setCheckoutUrl(null);
    setStatus(null);
    setPollingSlow(false);
  }, [stopPolling]);

  const formattedAmount =
    amount != null
      ? `${new Intl.NumberFormat('fr-FR').format(amount)} FCFA`
      : null;

  return (
    <View style={{ flex: 1, backgroundColor: theme.bg }}>
      <AppHeader title={t('saspay.title')} />
      <ScrollView contentContainerStyle={{ padding: space.lg, gap: space.lg }}>
        {/* Résumé du paiement — toujours affiché */}
        <View
          style={{
            backgroundColor: theme.surface,
            borderRadius: radius.lg,
            padding: space.xl,
            gap: space.sm,
          }}
        >
          <Subtitle>{t('saspay.summary')}</Subtitle>
          {tierName ? (
            <Text style={{ color: theme.textMuted, fontSize: type.body }}>
              {tierName}
              {billingPeriod === 'ANNUAL' ? ' · annuel' : ''}
            </Text>
          ) : null}
          <Title>{formattedAmount ?? '—'}</Title>
        </View>

        {status === null ? (
          <>
            <Text style={{ color: theme.textMuted, fontSize: type.body }}>
              {t('saspay.disclaimer')}
            </Text>
            <Button
              title={creating ? t('saspay.ctaOpening') : t('saspay.cta')}
              onPress={onPay}
              disabled={creating || !tierKey}
              loading={creating}
            />
          </>
        ) : null}

        {status === 'PENDING' ? (
          <View
            style={{
              backgroundColor: theme.surface,
              borderRadius: radius.lg,
              padding: space.xl,
              gap: space.md,
              alignItems: 'center',
            }}
          >
            <ActivityIndicator color={theme.primary} />
            <Text style={{ color: theme.text, fontSize: type.bodyLg, fontWeight: '700' }}>
              {t('saspay.waiting')}
            </Text>
            <Text style={{ color: theme.textMuted, fontSize: type.body, textAlign: 'center' }}>
              {t('saspay.waitingHint')}
            </Text>
            {pollingSlow ? (
              <Text
                style={{
                  color: theme.textMuted,
                  fontSize: type.caption,
                  textAlign: 'center',
                }}
              >
                {t('saspay.pollingSlow')}
              </Text>
            ) : null}
            <Row style={{ gap: space.md, flexWrap: 'wrap', justifyContent: 'center' }}>
              <Button title={t('saspay.checkNow')} variant="ghost" onPress={onCheckNow} />
              {checkoutUrl ? (
                <Button
                  title={opening ? t('saspay.ctaOpening') : t('saspay.openAgain')}
                  variant="ghost"
                  onPress={() => openCheckout(checkoutUrl)}
                  disabled={opening}
                />
              ) : null}
            </Row>
          </View>
        ) : null}

        {status === 'SUCCESS' ? (
          <View
            style={{
              backgroundColor: '#dcfce7',
              borderRadius: radius.lg,
              padding: space.xl,
              gap: space.md,
              alignItems: 'center',
            }}
          >
            <Ionicons name="checkmark-circle" size={48} color="#16a34a" />
            <Title>{t('saspay.success')}</Title>
            <Text
              style={{
                color: '#166534',
                fontSize: type.body,
                textAlign: 'center',
              }}
            >
              {t('saspay.successDetail')}
            </Text>
            <Button title={t('saspay.continue')} onPress={() => router.replace('/')} />
          </View>
        ) : null}

        {status === 'FAILED' || status === 'CANCELLED' || status === 'EXPIRED' ? (
          <View
            style={{
              backgroundColor: '#fee2e2',
              borderRadius: radius.lg,
              padding: space.xl,
              gap: space.md,
              alignItems: 'center',
            }}
          >
            <Ionicons name="close-circle" size={48} color="#dc2626" />
            <Title>
              {status === 'CANCELLED'
                ? t('saspay.cancelled')
                : status === 'EXPIRED'
                  ? t('saspay.expired')
                  : t('saspay.failed')}
            </Title>
            <Text
              style={{
                color: '#991b1b',
                fontSize: type.body,
                textAlign: 'center',
              }}
            >
              {t('saspay.failedDetail')}
            </Text>
            <Button title={t('saspay.retry')} onPress={onRetry} />
          </View>
        ) : null}
      </ScrollView>
    </View>
  );
}
