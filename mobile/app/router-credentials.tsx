import { useEffect, useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, Text, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api, extractErrorMessage } from '@/src/lib/api';
import {
  withApi,
  LanAuthFailedError,
  LanUnreachableError,
} from '@/src/services/mikrotik-lan/MikroTikApiClient';
import {
  getLocalCredentials,
  saveLocalCredentials,
  parseAddress,
} from '@/src/lib/router-credentials';
import {
  Banner,
  Button,
  Card,
  FadeIn,
  Field,
  Mono,
  NumberField,

  Row,
  Screen,
  space,
  type,
  weight,
  withAlpha,
} from '@/src/components/ui';
import { useTheme } from '@/src/providers/theme-provider';
import { AppHeader } from '@/src/components/AppHeader';

type TestState =
  | { kind: 'idle' }
  | { kind: 'testing' }
  | { kind: 'ok'; identity: string }
  | { kind: 'error'; message: string };

type SyncState = 'idle' | 'syncing' | 'synced' | 'not_found';

function StepIndicator({ step, current, label, icon }: { step: number; current: number; label: string; icon: keyof typeof Ionicons.glyphMap }) {
  const theme = useTheme();
  const done = current > step;
  const active = current === step;
  const color = done ? theme.success : active ? theme.primary : theme.textMuted;
  return (
    <View style={{ flex: 1, alignItems: 'center', gap: 4 }}>
      <View style={{
        width: 36, height: 36, borderRadius: 18,
        backgroundColor: withAlpha(color, done ? 0.15 : active ? 0.12 : 0.06),
        alignItems: 'center', justifyContent: 'center',
      }}>
        <Ionicons name={done ? 'checkmark' : icon} size={16} color={color} />
      </View>
      <Text style={{ color, fontSize: 10, fontWeight: active ? '700' : '500', textAlign: 'center' }}>{label}</Text>
    </View>
  );
}

export default function RouterCredentialsScreen() {
  const theme = useTheme();
  const { t } = useTranslation();
  const { routerId } = useLocalSearchParams<{ routerId: string }>();
  const router = useRouter();
  const qc = useQueryClient();

  const routerQuery = useQuery({
    queryKey: ['router', routerId],
    queryFn: () => api.routers.get(routerId),
    enabled: Boolean(routerId),
  });

  const [address, setAddress] = useState('');
  const [port, setPort] = useState('8728');
  const [username, setUsername] = useState('admin');
  const [password, setPassword] = useState('');
  const [test, setTest] = useState<TestState>({ kind: 'idle' });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [syncState, setSyncState] = useState<SyncState>('idle');

  useEffect(() => {
    if (!routerId || loaded) return;
    (async () => {
      const creds = await getLocalCredentials(routerId);
      if (creds) {
        setAddress(creds.host);
        setPort(String(creds.port));
        setUsername(creds.username);
        setPassword(creds.password);
        setLoaded(true);
        return;
      }
      setSyncState('syncing');
      try {
        const remote = await api.routers.getCredentials(routerId);
        if (remote?.username && remote?.host) {
          const parsed = parseAddress(remote.host);
          setAddress(parsed.host);
          setPort(String(parsed.port || 8728));
          setUsername(remote.username);
          setPassword(remote.password);
          await saveLocalCredentials(routerId, {
            username: remote.username,
            password: remote.password,
            host: parsed.host,
            port: parsed.port || 8728,
          });
          setSyncState('synced');
          setLoaded(true);
          return;
        }
      } catch {}
      setSyncState('not_found');
      if (routerQuery.data?.localAddress) {
        const parsed = parseAddress(routerQuery.data.localAddress);
        setAddress(parsed.host);
        setPort(String(parsed.port || 8728));
      }
      setLoaded(true);
    })();
  }, [routerId, routerQuery.data, loaded]);

  const portNum = Number.parseInt(port, 10) || 8728;
  const currentStep = test.kind === 'ok' ? 3 : (address.trim() && password) ? 2 : 1;

  async function testConnection() {
    setError(null);
    if (!address.trim()) {
      setTest({ kind: 'error', message: t('routerCredentials.addressRequired') });
      return;
    }
    setTest({ kind: 'testing' });
    try {
      const res = await withApi(
        { host: address.trim(), port: portNum, username, password },
        (c) => c.systemIdentity(),
      );
      setTest({ kind: 'ok', identity: res.name });
    } catch (e) {
      const message =
        e instanceof LanAuthFailedError
          ? t('addRouter.authFailed')
          : e instanceof LanUnreachableError
            ? t('addRouter.unreachable')
            : extractErrorMessage(e);
      setTest({ kind: 'error', message });
    }
  }

  async function save() {
    if (!routerId) return;
    setError(null);
    setSaving(true);
    try {
      const creds = {
        host: address.trim(),
        port: portNum,
        username,
        password,
      };
      await saveLocalCredentials(routerId, creds);
      try {
        await api.routers.update(routerId, {
          credentials: { username, password },
          localAddress: `${address.trim()}:${portNum}`,
        });
      } catch {}
      qc.invalidateQueries({ queryKey: ['router-local-creds'] });
      router.back();
    } catch (e) {
      setError(extractErrorMessage(e));
    } finally {
      setSaving(false);
    }
  }

  const canSave = address.trim().length > 0 && password.length > 0;

  return (
    <View style={{ flex: 1, backgroundColor: theme.bg }}>
      <AppHeader title={t('routerCredentials.screenTitle')} back />
      <Screen>
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          style={{ flex: 1 }}
        >
          <ScrollView contentContainerStyle={{ gap: space.md, padding: space.lg }} keyboardShouldPersistTaps="handled">
            {/* Step indicator */}
            <FadeIn>
              <Row style={{ gap: 0, paddingVertical: space.sm }}>
                <StepIndicator step={1} current={currentStep} label={t('routerCredentials.stepAddress')} icon="globe-outline" />
                <View style={{ height: 1, flex: 0.5, backgroundColor: withAlpha(theme.border, 0.5), marginTop: -12 }} />
                <StepIndicator step={2} current={currentStep} label={t('routerCredentials.stepAuth')} icon="key-outline" />
                <View style={{ height: 1, flex: 0.5, backgroundColor: withAlpha(theme.border, 0.5), marginTop: -12 }} />
                <StepIndicator step={3} current={currentStep} label={t('routerCredentials.stepTest')} icon="shield-checkmark-outline" />
              </Row>
            </FadeIn>

            {/* Sync status */}
            {syncState === 'synced' ? (
              <FadeIn>
                <View style={{
                  flexDirection: 'row', alignItems: 'center', gap: 8,
                  backgroundColor: withAlpha(theme.success, 0.08),
                  borderRadius: 12, padding: 12,
                }}>
                  <Ionicons name="cloud-done" size={18} color={theme.success} />
                  <Text style={{ color: theme.success, fontSize: 12, fontWeight: '600', flex: 1 }}>
                    {t('routerCredentials.syncedFromServer')}
                  </Text>
                </View>
              </FadeIn>
            ) : null}

            {/* Router info header */}
            <FadeIn delay={50}>
              <Card style={{ gap: 10 }}>
                <Row style={{ gap: 12 }}>
                  <View style={{
                    width: 48, height: 48, borderRadius: 14,
                    backgroundColor: withAlpha(theme.primary, 0.1),
                    alignItems: 'center', justifyContent: 'center',
                  }}>
                    <Ionicons name="hardware-chip" size={22} color={theme.primary} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={{ color: theme.text, fontWeight: weight.bold, fontSize: type.bodyLg }}>
                      {routerQuery.data?.alias || routerQuery.data?.identity || '—'}
                    </Text>
                    <Mono style={{ color: theme.textMuted, fontSize: 11 }}>
                      {routerQuery.data?.identity ?? ''}
                    </Mono>
                  </View>
                </Row>
                <Text style={{ color: theme.textMuted, fontSize: 12, lineHeight: 18 }}>
                  {t('routerCredentials.description')}
                </Text>
              </Card>
            </FadeIn>

            {error ? <Banner tone="danger">{error}</Banner> : null}

            {/* Connection fields */}
            <FadeIn delay={100}>
              <Card style={{ gap: 12 }}>
                <Row style={{ gap: 8, justifyContent: 'flex-start' }}>
                  <Ionicons name="globe-outline" size={15} color={theme.primary} />
                  <Text style={{ color: theme.text, fontWeight: weight.bold, fontSize: 13 }}>
                    {t('routerCredentials.connectionSection')}
                  </Text>
                </Row>
                <Row style={{ gap: 10 }}>
                  <View style={{ flex: 1 }}>
                    <Field
                      label={t('routerCredentials.addressLabel')}
                      placeholder="192.168.88.1"
                      value={address}
                      onChangeText={setAddress}
                      autoCapitalize="none"
                      keyboardType="numbers-and-punctuation"
                    />
                  </View>
                  <View style={{ width: 85 }}>
                    <NumberField
                      label={t('routerCredentials.portLabel')}
                      placeholder="8728"
                      value={port}
                      onChangeValue={setPort}
                      min={1}
                      max={65535}
                    />
                  </View>
                </Row>
              </Card>
            </FadeIn>

            {/* Auth fields */}
            <FadeIn delay={150}>
              <Card style={{ gap: 12 }}>
                <Row style={{ gap: 8, justifyContent: 'flex-start' }}>
                  <Ionicons name="key-outline" size={15} color={theme.primaryMuted} />
                  <Text style={{ color: theme.text, fontWeight: weight.bold, fontSize: 13 }}>
                    {t('routerCredentials.authSection')}
                  </Text>
                </Row>
                <Field
                  label={t('routerCredentials.routerosUser')}
                  value={username}
                  onChangeText={setUsername}
                  autoCapitalize="none"
                />
                <Field
                  label={t('routerCredentials.routerosPassword')}
                  value={password}
                  onChangeText={setPassword}
                  secureTextEntry
                />
              </Card>
            </FadeIn>

            {/* Test connection */}
            <FadeIn delay={200}>
              <Button
                title={t('routerCredentials.testConnection')}
                variant="ghost"
                onPress={testConnection}
                loading={test.kind === 'testing'}
              />
            </FadeIn>

            {test.kind === 'ok' ? (
              <FadeIn>
                <View style={{
                  flexDirection: 'row', alignItems: 'center', gap: 10,
                  backgroundColor: withAlpha(theme.success, 0.08),
                  borderRadius: 14, padding: 14,
                }}>
                  <View style={{
                    width: 40, height: 40, borderRadius: 20,
                    backgroundColor: withAlpha(theme.success, 0.15),
                    alignItems: 'center', justifyContent: 'center',
                  }}>
                    <Ionicons name="checkmark-circle" size={22} color={theme.success} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={{ color: theme.success, fontWeight: '700', fontSize: 13 }}>
                      {t('routerCredentials.connectionSuccess')}
                    </Text>
                    <Mono style={{ color: theme.textMuted, fontSize: 11 }}>
                      {test.identity}
                    </Mono>
                  </View>
                </View>
              </FadeIn>
            ) : null}
            {test.kind === 'error' ? (
              <Banner tone="danger">{test.message}</Banner>
            ) : null}

            {/* Save */}
            <FadeIn delay={250}>
              <Button
                title={t('routerCredentials.saveCredentials')}
                onPress={save}
                loading={saving}
                disabled={!canSave}
              />
            </FadeIn>

            <Text style={{ color: theme.textMuted, fontSize: 10, textAlign: 'center', lineHeight: 16, paddingHorizontal: space.lg }}>
              {t('routerCredentials.securityNote')}
            </Text>
          </ScrollView>
        </KeyboardAvoidingView>
      </Screen>
    </View>
  );
}
