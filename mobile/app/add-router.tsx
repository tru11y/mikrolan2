import { useState } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  Text,
  View,
} from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import axios from 'axios';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api, extractErrorMessage } from '@/src/lib/api';
import {
  withApi,
  LanAuthFailedError,
  LanUnreachableError,
} from '@/src/services/mikrotik-lan/MikroTikApiClient';
import { scanLan } from '@/src/services/mikrotik-lan/lanScan';
import { saveLocalCredentials } from '@/src/lib/router-credentials';
import {
  Banner,
  Button,
  Card,
  Field,
  NumberField,
  Press,
  Screen,
  withAlpha,
} from '@/src/components/ui';
import { useTheme } from '@/src/providers/theme-provider';
import { AppHeader } from '@/src/components/AppHeader';

type TestState =
  | { kind: 'idle' }
  | { kind: 'testing' }
  | { kind: 'ok'; identity: string }
  | { kind: 'error'; message: string };

type ScanState =
  | { kind: 'idle' }
  | { kind: 'scanning'; done: number; total: number }
  | {
      kind: 'done';
      ip: string | null;
      gateway: string | null;
      hosts: string[];
    };

/** Rend un nom de routeur unique en le suffixant s'il est déjà pris — le
 *  nom d'usine RouterOS ("MikroTik") est identique sur tous les appareils
 *  non renommés, donc un simple auto-remplissage collisionne dès le 2e. */
function dedupeIdentity(base: string, taken: Set<string>): string {
  if (!taken.has(base)) return base;
  let i = 2;
  while (taken.has(`${base}-${i}`)) i += 1;
  return `${base}-${i}`;
}

export default function AddRouterScreen() {
  const theme = useTheme();
  const { t } = useTranslation();
  const router = useRouter();
  const qc = useQueryClient();
  const existingRouters = useQuery({
    queryKey: ['routers'],
    queryFn: api.routers.list,
  });
  const takenIdentities = new Set(
    (existingRouters.data ?? []).map((r) => r.identity),
  );
  const [address, setAddress] = useState('');
  const [port, setPort] = useState('8728');
  const [identity, setIdentity] = useState('');
  const [alias, setAlias] = useState('');
  const [username, setUsername] = useState('admin');
  const [password, setPassword] = useState('');
  const [test, setTest] = useState<TestState>({ kind: 'idle' });
  const [scan, setScan] = useState<ScanState>({ kind: 'idle' });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [identityNote, setIdentityNote] = useState<string | null>(null);

  const portNum = Number.parseInt(port, 10) || 8728;

  async function runScan() {
    setError(null);
    setScan({ kind: 'scanning', done: 0, total: 255 });
    try {
      const res = await scanLan(portNum, (done, total) =>
        setScan({ kind: 'scanning', done, total }),
      );
      setScan({
        kind: 'done',
        ip: res.ip,
        gateway: res.gateway,
        hosts: res.hosts,
      });
      if (res.gateway && !address) setAddress(res.gateway);
    } catch (e) {
      setScan({ kind: 'idle' });
      setError(extractErrorMessage(e));
    }
  }

  async function testLocal() {
    setError(null);
    if (!address.trim()) {
      setTest({ kind: 'error', message: t('addRouter.addressRequired') });
      return;
    }
    setTest({ kind: 'testing' });
    try {
      const res = await withApi(
        { host: address.trim(), port: portNum, username, password },
        (c) => c.systemIdentity(),
      );
      setTest({ kind: 'ok', identity: res.name });
      if (!identity) {
        const suggested = dedupeIdentity(res.name, takenIdentities);
        setIdentity(suggested);
        if (suggested !== res.name) {
          setIdentityNote(
            t('addRouter.nameAdapted', { name: res.name }),
          );
        }
      }
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
    setError(null);
    setSaving(true);
    try {
      const isFirstRouter = (existingRouters.data ?? []).length === 0;
      const created = await api.routers.create({
        identity: identity.trim(),
        alias: alias.trim() || undefined,
        localAddress: `${address.trim()}:${portNum}`,
        mode: 'LOCAL',
      });
      if (address.trim() && password) {
        await saveLocalCredentials(created.id, {
          host: address.trim(),
          port: portNum,
          username,
          password,
        });
      }
      await qc.invalidateQueries({ queryKey: ['routers'] });
      if (isFirstRouter) {
        router.replace({
          pathname: '/hotspot-setup',
          params: { routerId: created.id, onboarding: '1' },
        });
      } else {
        router.back();
      }
    } catch (e) {
      const status = axios.isAxiosError(e) ? e.response?.status : null;
      setError(
        status === 409
          ? t('addRouter.nameConflict', { name: identity.trim() })
          : extractErrorMessage(e),
      );
    } finally {
      setSaving(false);
    }
  }

  const canSave = identity.trim().length >= 2;

  return (
    <View style={{ flex: 1, backgroundColor: theme.bg }}>
      <AppHeader title={t('addRouter.title')} back />
      <Screen>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={{ flex: 1 }}
      >
        <ScrollView contentContainerStyle={{ gap: 16 }} keyboardShouldPersistTaps="handled">
          <Card>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
              <View
                style={{
                  width: 48,
                  height: 48,
                  borderRadius: 14,
                  backgroundColor: withAlpha(theme.primaryMuted, 0.13),
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                <Ionicons name="hardware-chip-outline" size={24} color={theme.primaryMuted} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={{ color: theme.text, fontWeight: '700', fontSize: 15 }}>
                  {t('addRouter.mikrotikApi')}
                </Text>
                <Text style={{ color: theme.textMuted, fontSize: 12 }}>
                  {t('addRouter.apiInfo')}
                </Text>
              </View>
            </View>
          </Card>

          {error ? <Banner tone="danger">{error}</Banner> : null}

          <Card>
            <View style={{ flexDirection: 'row', gap: 10 }}>
              <View style={{ flex: 1 }}>
                <Field
                  label={t('addRouter.address')}
                  placeholder="192.168.88.1"
                  value={address}
                  onChangeText={setAddress}
                  autoCapitalize="none"
                  keyboardType="numbers-and-punctuation"
                />
              </View>
              <View style={{ width: 90 }}>
                <NumberField
                  label={t('addRouter.port')}
                  placeholder="8728"
                  value={port}
                  onChangeValue={setPort}
                  min={1}
                  max={65535}
                />
              </View>
            </View>

            <Press
              onPress={runScan}
              disabled={scan.kind === 'scanning'}
              accessibilityRole="button"
              style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 4 }}
            >
              <Ionicons name="search" size={15} color={theme.primaryMuted} />
              <Text style={{ color: theme.primaryMuted, fontSize: 13.5, fontWeight: '600' }}>
                {scan.kind === 'scanning'
                  ? t('addRouter.scanning', { done: scan.done, total: scan.total })
                  : t('addRouter.scanRouters')}
              </Text>
            </Press>

            {scan.kind === 'done' ? (
              <Text style={{ color: theme.textMuted, fontSize: 11.5, fontFamily: theme.mono }}>
                {scan.ip
                  ? `${t('addRouter.phoneIp', { ip: scan.ip })}${scan.gateway ? ` · ${t('addRouter.gateway', { gateway: scan.gateway })}` : ''}`
                  : t('addRouter.ipUnavailable')}
              </Text>
            ) : null}
            {scan.kind === 'done' && scan.hosts.length > 0 ? (
              <View style={{ gap: 6 }}>
                {scan.hosts.map((h) => (
                  <Press
                    key={h}
                    onPress={() => {
                      setAddress(h);
                      setScan({ kind: 'idle' });
                    }}
                    style={{
                      borderRadius: 10,
                      padding: 11,
                      backgroundColor: theme.surfaceAlt,
                    }}
                  >
                    <Text style={{ color: theme.text, fontFamily: theme.mono }}>
                      {h}:{portNum}
                    </Text>
                  </Press>
                ))}
              </View>
            ) : null}
            {scan.kind === 'done' && scan.hosts.length === 0 ? (
              <Banner tone="warning">
                {t('addRouter.noRouterDetected', { port: portNum })}
              </Banner>
            ) : null}
          </Card>

          <Card>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
              <Ionicons name="key-outline" size={15} color={theme.primary} />
              <Text
                style={{
                  color: theme.text,
                  fontSize: 12,
                  fontWeight: '700',
                  letterSpacing: 0.5,
                }}
              >
                {t('addRouter.adminCredentials')}
              </Text>
            </View>
            <Field
              label={t('addRouter.routerosUser')}
              value={username}
              onChangeText={setUsername}
              autoCapitalize="none"
            />
            <Field
              label={t('addRouter.routerosPassword')}
              value={password}
              onChangeText={setPassword}
              secureTextEntry
            />
            <Button
              title={t('addRouter.testLocal')}
              variant="ghost"
              onPress={testLocal}
              loading={test.kind === 'testing'}
            />
            {test.kind === 'ok' ? (
              <Banner tone="success">
                <Ionicons name="checkmark-circle" size={14} color={theme.success} />{' '}
                {t('addRouter.connected', { identity: test.identity })}
              </Banner>
            ) : null}
            {test.kind === 'error' ? (
              <Banner tone="danger">{test.message}</Banner>
            ) : null}
          </Card>

          <Card>
            <Field
              label={t('addRouter.routerName')}
              placeholder={t('addRouter.namePlaceholder')}
              value={identity}
              onChangeText={(v) => {
                setIdentity(v);
                setIdentityNote(null);
              }}
              autoCapitalize="characters"
            />
            {identityNote ? (
              <Banner tone="warning">{identityNote}</Banner>
            ) : null}
            <Field
              label={t('addRouter.alias')}
              placeholder={t('addRouter.aliasPlaceholder')}
              value={alias}
              onChangeText={setAlias}
            />
            <Button
              title={t('addRouter.saveRouter')}
              onPress={save}
              loading={saving}
              disabled={!canSave}
            />
          </Card>
        </ScrollView>
      </KeyboardAvoidingView>
      </Screen>
    </View>
  );
}
