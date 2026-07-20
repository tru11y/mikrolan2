import { useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView } from 'react-native';
import { useRouter } from 'expo-router';
import { useQueryClient } from '@tanstack/react-query';
import { api, extractErrorMessage } from '@/src/lib/api';
import {
  MikroTikLanClient,
  LanAuthFailedError,
  LanUnreachableError,
} from '@/src/services/mikrotik-lan/MikroTikLanClient';
import {
  parseAddress,
  saveLocalCredentials,
} from '@/src/lib/router-credentials';
import {
  Banner,
  Button,
  Card,
  Field,
  Screen,
  Subtitle,
  Title,
} from '@/src/components/ui';

type TestState =
  | { kind: 'idle' }
  | { kind: 'testing' }
  | { kind: 'ok'; identity: string }
  | { kind: 'error'; message: string };

export default function AddRouterScreen() {
  const router = useRouter();
  const qc = useQueryClient();
  const [identity, setIdentity] = useState('');
  const [alias, setAlias] = useState('');
  const [address, setAddress] = useState('');
  const [username, setUsername] = useState('admin');
  const [password, setPassword] = useState('');
  const [test, setTest] = useState<TestState>({ kind: 'idle' });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function testLocal() {
    setError(null);
    setTest({ kind: 'testing' });
    const { host, port } = parseAddress(address);
    if (!host) {
      setTest({ kind: 'error', message: 'Adresse du routeur invalide' });
      return;
    }
    try {
      const client = new MikroTikLanClient({ host, port, username, password });
      const res = await client.systemIdentity();
      setTest({ kind: 'ok', identity: res.name });
      if (!identity) setIdentity(res.name);
    } catch (e) {
      const message =
        e instanceof LanAuthFailedError
          ? 'Identifiants RouterOS incorrects'
          : e instanceof LanUnreachableError
            ? e.message
            : 'Échec de la connexion locale';
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
        localAddress: address.trim() || undefined,
        mode: 'LOCAL',
        // Free/local mode: credentials stay on-device, not sent to the backend.
      });
      const { host, port } = parseAddress(address);
      if (host && password) {
        await saveLocalCredentials(created.id, {
          host,
          port,
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
        <ScrollView contentContainerStyle={{ gap: 16 }}>
          <Title>Ajouter un routeur</Title>
          <Subtitle>
            Testez la connexion locale (LAN) puis enregistrez. Les identifiants
            restent sur votre téléphone.
          </Subtitle>

          {error ? <Banner tone="danger">{error}</Banner> : null}

          <Card>
            <Field
              label="Adresse locale (IP:port)"
              placeholder="192.168.88.1:80"
              value={address}
              onChangeText={setAddress}
              autoCapitalize="none"
              keyboardType="numbers-and-punctuation"
            />
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
                Connecté ✓ — identité détectée : {test.identity}
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
