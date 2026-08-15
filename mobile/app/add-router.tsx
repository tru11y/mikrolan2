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
  theme,
} from '@/src/components/ui';
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
      setTest({ kind: 'error', message: 'Renseignez l’adresse du routeur' });
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
            `Le nom « ${res.name} » est déjà utilisé par un autre de vos routeurs, nous l’avons adapté.`,
          );
        }
      }
    } catch (e) {
      const message =
        e instanceof LanAuthFailedError
          ? 'Identifiants RouterOS incorrects'
          : e instanceof LanUnreachableError
            ? "Routeur injoignable — vérifiez l'adresse et que le routeur est allumé."
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
          ? `Vous avez déjà un routeur nommé « ${identity.trim()} ». Choisissez un autre nom.`
          : extractErrorMessage(e),
      );
    } finally {
      setSaving(false);
    }
  }

  const canSave = identity.trim().length >= 2;

  return (
    <View style={{ flex: 1, backgroundColor: theme.bg }}>
      <AppHeader title="Ajouter un routeur" back />
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
                  backgroundColor: theme.secondary + '22',
                  borderWidth: 1,
                  borderColor: theme.secondary + '55',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                <Ionicons name="hardware-chip-outline" size={24} color={theme.secondary} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={{ color: theme.text, fontWeight: '700', fontSize: 15 }}>
                  Connexion API MikroTik
                </Text>
                <Text style={{ color: theme.textMuted, fontSize: 12 }}>
                  Port API RouterOS (défaut 8728). Les identifiants restent sur
                  votre téléphone.
                </Text>
              </View>
            </View>
          </Card>

          {error ? <Banner tone="danger">{error}</Banner> : null}

          <Card>
            <View style={{ flexDirection: 'row', gap: 10 }}>
              <View style={{ flex: 1 }}>
                <Field
                  label="Adresse"
                  placeholder="192.168.88.1"
                  value={address}
                  onChangeText={setAddress}
                  autoCapitalize="none"
                  keyboardType="numbers-and-punctuation"
                />
              </View>
              <View style={{ width: 90 }}>
                <NumberField
                  label="Port"
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
              <Ionicons name="search" size={15} color={theme.secondary} />
              <Text style={{ color: theme.secondary, fontSize: 13.5, fontWeight: '600' }}>
                {scan.kind === 'scanning'
                  ? `Recherche… ${scan.done}/${scan.total}`
                  : 'Rechercher les routeurs sur mon réseau'}
              </Text>
            </Press>

            {scan.kind === 'done' ? (
              <Text style={{ color: theme.textMuted, fontSize: 11.5, fontFamily: theme.mono }}>
                {scan.ip
                  ? `Tél ${scan.ip}${scan.gateway ? ` · passerelle ${scan.gateway}` : ''}`
                  : 'IP locale indisponible — connectez le Wi-Fi du routeur.'}
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
                      borderWidth: 1,
                      borderColor: theme.border,
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
                Aucun routeur détecté. Le téléphone doit être sur le même Wi-Fi
                que le routeur, et le port www/REST ({portNum}) activé.
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
                IDENTIFIANTS ADMINISTRATEUR
              </Text>
            </View>
            <Field
              label="Utilisateur RouterOS"
              value={username}
              onChangeText={setUsername}
              autoCapitalize="none"
            />
            <Field
              label="Mot de passe RouterOS"
              value={password}
              onChangeText={setPassword}
              secureTextEntry
            />
            <Button
              title="Tester la connexion locale"
              variant="ghost"
              onPress={testLocal}
              loading={test.kind === 'testing'}
            />
            {test.kind === 'ok' ? (
              <Banner tone="success">
                <Ionicons name="checkmark-circle" size={14} color={theme.success} />{' '}
                Connecté — identité : {test.identity}
              </Banner>
            ) : null}
            {test.kind === 'error' ? (
              <Banner tone="danger">{test.message}</Banner>
            ) : null}
          </Card>

          <Card>
            <Field
              label="Nom du routeur (unique sur votre compte)"
              placeholder="BOUTIQUE-PLATEAU"
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
              label="Alias (optionnel)"
              placeholder="Routeur du plateau"
              value={alias}
              onChangeText={setAlias}
            />
            <Button
              title="Enregistrer le routeur"
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
