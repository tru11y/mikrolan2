import { useState } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  Text,
  View,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useQueryClient } from '@tanstack/react-query';
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
  Screen,
  Subtitle,
  theme,
  Title,
} from '@/src/components/ui';

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

export default function AddRouterScreen() {
  const router = useRouter();
  const qc = useQueryClient();
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
      if (!identity) setIdentity(res.name);
    } catch (e) {
      const message =
        e instanceof LanAuthFailedError
          ? 'Identifiants RouterOS incorrects'
          : e instanceof LanUnreachableError
            ? e.message
            : `Échec: ${extractErrorMessage(e)}`;
      setTest({ kind: 'error', message });
    }
  }

  async function save() {
    setError(null);
    setSaving(true);
    try {
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
      router.back();
    } catch (e) {
      setError(extractErrorMessage(e));
    } finally {
      setSaving(false);
    }
  }

  const canSave = identity.trim().length >= 2;

  return (
    <Screen>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={{ flex: 1 }}
      >
        <ScrollView contentContainerStyle={{ gap: 16 }} keyboardShouldPersistTaps="handled">
          <Title>Ajouter un routeur</Title>
          <Subtitle>
            Adresse locale du routeur ou recherche automatique sur votre réseau.
            Les identifiants restent sur votre téléphone.
          </Subtitle>

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
              <View style={{ width: 84 }}>
                <Field
                  label="Port"
                  placeholder="8728"
                  value={port}
                  onChangeText={(v) => setPort(v.replace(/[^0-9]/g, ''))}
                  keyboardType="number-pad"
                />
              </View>
            </View>

            <Pressable
              onPress={runScan}
              disabled={scan.kind === 'scanning'}
              accessibilityRole="button"
              style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 4 }}
            >
              <Text style={{ color: theme.primary, fontSize: 15 }}>⌕</Text>
              <Text style={{ color: theme.primary, fontSize: 13.5, fontWeight: '600' }}>
                {scan.kind === 'scanning'
                  ? `Recherche… ${scan.done}/${scan.total}`
                  : 'Rechercher les routeurs sur mon réseau'}
              </Text>
            </Pressable>

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
                  <Pressable
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
                  </Pressable>
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
                Connecté ✓ — identité : {test.identity}
              </Banner>
            ) : null}
            {test.kind === 'error' ? (
              <Banner tone="danger">{test.message}</Banner>
            ) : null}
          </Card>

          <Card>
            <Field
              label="Identifiant (unique)"
              placeholder="AGENCE-01"
              value={identity}
              onChangeText={setIdentity}
              autoCapitalize="characters"
            />
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
  );
}
