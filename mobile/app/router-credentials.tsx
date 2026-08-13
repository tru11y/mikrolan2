import { useEffect, useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, Text, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';
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
import { Banner, Button, Card, Field, NumberField, Screen, theme } from '@/src/components/ui';
import { AppHeader } from '@/src/components/AppHeader';

/**
 * Ressaisie/correction des identifiants RouterOS d'un routeur déjà enregistré.
 *
 * `saveLocalCredentials` n'était appelé qu'une fois, pendant l'assistant
 * d'ajout (`add-router.tsx`) : un mot de passe changé côté routeur, une
 * réinstallation de l'app ou un changement de téléphone rendaient le mode
 * local (appareils autorisés, sessions) définitivement inopérant sans aucun
 * moyen de le réparer. Cet écran comble ce trou.
 */

type TestState =
  | { kind: 'idle' }
  | { kind: 'testing' }
  | { kind: 'ok'; identity: string }
  | { kind: 'error'; message: string };

export default function RouterCredentialsScreen() {
  const { routerId } = useLocalSearchParams<{ routerId: string }>();
  const router = useRouter();

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

  useEffect(() => {
    if (!routerId || loaded) return;
    (async () => {
      const creds = await getLocalCredentials(routerId);
      if (creds) {
        setAddress(creds.host);
        setPort(String(creds.port));
        setUsername(creds.username);
        setPassword(creds.password);
      } else if (routerQuery.data?.localAddress) {
        const parsed = parseAddress(routerQuery.data.localAddress);
        setAddress(parsed.host);
        setPort(String(parsed.port || 8728));
      }
      setLoaded(true);
    })();
  }, [routerId, routerQuery.data, loaded]);

  const portNum = Number.parseInt(port, 10) || 8728;

  async function testConnection() {
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
    if (!routerId) return;
    setError(null);
    setSaving(true);
    try {
      await saveLocalCredentials(routerId, {
        host: address.trim(),
        port: portNum,
        username,
        password,
      });
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
      <AppHeader title="Identifiants du routeur" back />
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
                  <Ionicons name="key-outline" size={24} color={theme.secondary} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={{ color: theme.text, fontWeight: '700', fontSize: 15 }}>
                    Connexion API MikroTik
                  </Text>
                  <Text style={{ color: theme.textMuted, fontSize: 12 }}>
                    Sans ces identifiants sur ce téléphone, les appareils
                    autorisés et les sessions de ce routeur ne peuvent pas
                    s'afficher.
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
                title="Tester la connexion"
                variant="ghost"
                onPress={testConnection}
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

            <Button
              title="Enregistrer les identifiants"
              onPress={save}
              loading={saving}
              disabled={!canSave}
            />
          </ScrollView>
        </KeyboardAvoidingView>
      </Screen>
    </View>
  );
}
