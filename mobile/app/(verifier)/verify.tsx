export { ScreenErrorBoundary as ErrorBoundary } from '@/src/components/ScreenErrorBoundary';
import { useMemo, useState } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  Text,
  View,
} from 'react-native';
import { useRouter } from 'expo-router';
import axios from 'axios';
import {
  Button,
  Card,
  Field,
  Screen,
  Subtitle,
  Title,
  space,
  toneColor,
  type,
} from '@/src/components/ui';
import { useTheme } from '@/src/providers/theme-provider';
import { api, type TicketVerificationResponse } from '@/src/lib/api';
import {
  httpErrorView,
  isValidLength,
  normalizeTicketCode,
  verdictView,
  type HttpErrorView,
  type VerdictView,
} from '@/src/lib/verifierMapping';
import { reportSilent } from '@/src/lib/report';

type ScreenState =
  | { kind: 'idle' }
  | { kind: 'result'; result: TicketVerificationResponse; view: VerdictView }
  | { kind: 'error'; view: HttpErrorView };

function Pill({ tone, label }: { tone: VerdictView['tone']; label: string }) {
  return (
    <View
      style={{
        paddingHorizontal: space.md,
        paddingVertical: space.xs,
        borderRadius: 999,
        backgroundColor: toneColor(tone),
      }}
    >
      <Text style={{ color: '#000', fontSize: type.caption, fontWeight: '700' }}>
        {label}
      </Text>
    </View>
  );
}

export default function VerifyScreen() {
  const theme = useTheme();
  const router = useRouter();
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [state, setState] = useState<ScreenState>({ kind: 'idle' });

  const canSubmit = useMemo(() => !busy && isValidLength(code), [busy, code]);

  async function verify(): Promise<void> {
    if (!canSubmit) return;
    const normalized = normalizeTicketCode(code);
    setBusy(true);
    try {
      const result = await api.ticketVerification.verify(normalized);
      setState({ kind: 'result', result, view: verdictView(result) });
    } catch (err) {
      // JAMAIS le code complet dans les logs mobiles.
      reportSilent('verify-ticket.request-failed', err);
      const httpStatus = axios.isAxiosError(err) ? err.response?.status : undefined;
      setState({ kind: 'error', view: httpErrorView(httpStatus) });
    } finally {
      setBusy(false);
    }
  }

  function reset(): void {
    setCode('');
    setState({ kind: 'idle' });
  }

  const blocking = state.kind === 'error' && state.view.blocking;

  return (
    <KeyboardAvoidingView
      style={{ flex: 1 }}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <Screen>
        <ScrollView
          contentContainerStyle={{ padding: space.lg, gap: space.md }}
          keyboardShouldPersistTaps="handled"
        >
          <Title>Vérifier un ticket</Title>
          <Subtitle>Saisissez le code du client.</Subtitle>

          {!blocking && (
            <Card>
              <Field
                label="Code du ticket"
                placeholder="EX. ABC12345"
                value={code}
                onChangeText={setCode}
                autoCapitalize="characters"
                autoCorrect={false}
                autoComplete="off"
                maxLength={64}
                editable={!busy}
                returnKeyType="go"
                onSubmitEditing={verify}
                testID="verify-ticket-code-input"
              />
              <View style={{ marginTop: space.md }}>
                <Button
                  title={busy ? 'Vérification…' : 'Vérifier'}
                  onPress={verify}
                  loading={busy}
                  disabled={!canSubmit}
                  accessibilityLabel="Vérifier le ticket"
                />
              </View>
            </Card>
          )}

          {state.kind === 'result' && (
            <Card>
              <View style={{ gap: space.sm }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm }}>
                  <Pill tone={state.view.tone} label={state.result.status} />
                  <Text style={{ color: theme.text, fontSize: type.body, fontWeight: '700' }}>
                    {state.view.title}
                  </Text>
                </View>
                {state.view.subtitle && (
                  <Text style={{ color: theme.textMuted, fontSize: type.caption }}>
                    {state.view.subtitle}
                  </Text>
                )}
                {state.result.ticket && state.result.status === 'VALID' && (
                  <View style={{ gap: space.xs }}>
                    <Text style={{ color: theme.textMuted, fontSize: type.caption }}>
                      Forfait : {state.result.ticket.planName}
                    </Text>
                    <Text style={{ color: theme.textMuted, fontSize: type.caption }}>
                      Durée : {state.result.ticket.durationMinutes} min
                    </Text>
                  </View>
                )}
                <Text style={{ color: toneColor(state.view.tone), fontWeight: '700' }}>
                  {state.view.actionLabel}
                </Text>
                <View style={{ marginTop: space.sm, gap: space.sm }}>
                  <Button
                    title="Vérifier un autre ticket"
                    variant="ghost"
                    onPress={reset}
                  />
                </View>
              </View>
            </Card>
          )}

          {state.kind === 'error' && (
            <Card>
              <View style={{ gap: space.sm }}>
                <Text style={{ color: toneColor(state.view.tone), fontSize: type.body, fontWeight: '700' }}>
                  {state.view.title}
                </Text>
                <Text style={{ color: theme.textMuted, fontSize: type.caption }}>
                  {state.view.subtitle}
                </Text>
                {!state.view.blocking && (
                  <Button title="Réessayer" variant="ghost" onPress={reset} />
                )}
              </View>
            </Card>
          )}

          <View style={{ marginTop: space.lg }}>
            <Button
              title="Mon compte"
              variant="ghost"
              onPress={() => router.push('/(verifier)/account')}
            />
          </View>
        </ScrollView>
      </Screen>
    </KeyboardAvoidingView>
  );
}
