import { useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAuth } from '@/src/providers/auth-provider';
import {
  Banner,
  Button,
  Card,
  Field,
  Screen,
  Subtitle,
  Title,
  theme,
} from '@/src/components/ui';

export default function LoginScreen() {
  const { login, signup, isBusy, error, clearError, apiBaseUrl, updateApiBaseUrl } =
    useAuth();
  const insets = useSafeAreaInsets();
  const [mode, setMode] = useState<'login' | 'signup'>('login');
  const [tenantName, setTenantName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showConfig, setShowConfig] = useState(false);
  const [baseUrl, setBaseUrl] = useState(apiBaseUrl);

  async function submit() {
    clearError();
    try {
      if (mode === 'signup') {
        await signup(tenantName.trim(), email.trim(), password);
      } else {
        await login(email.trim(), password);
      }
    } catch {
      // error surfaced via context
    }
  }

  const canSubmit =
    email.trim().length > 3 &&
    password.length >= (mode === 'signup' ? 10 : 1) &&
    (mode === 'login' || tenantName.trim().length >= 2);

  return (
    <Screen>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={{ flex: 1 }}
      >
        <ScrollView
          contentContainerStyle={{
            flexGrow: 1,
            justifyContent: 'center',
            paddingTop: insets.top,
            gap: 20,
          }}
          keyboardShouldPersistTaps="handled"
        >
          <View style={{ gap: 6 }}>
            <Title>MikroLan</Title>
            <Subtitle>
              {mode === 'login'
                ? 'Connectez-vous à votre espace'
                : 'Créez votre compte et gérez vos routeurs'}
            </Subtitle>
          </View>

          {error ? <Banner tone="danger">{error}</Banner> : null}

          <Card>
            {mode === 'signup' ? (
              <Field
                label="Nom de l'organisation"
                placeholder="Mon ISP"
                value={tenantName}
                onChangeText={setTenantName}
                autoCapitalize="words"
              />
            ) : null}
            <Field
              label="Email"
              placeholder="vous@exemple.ci"
              value={email}
              onChangeText={setEmail}
              autoCapitalize="none"
              keyboardType="email-address"
              autoComplete="email"
            />
            <Field
              label="Mot de passe"
              placeholder={mode === 'signup' ? '10 caractères minimum' : '••••••••'}
              value={password}
              onChangeText={setPassword}
              secureTextEntry
            />
            <Button
              title={mode === 'signup' ? 'Créer mon compte' : 'Se connecter'}
              onPress={submit}
              loading={isBusy}
              disabled={!canSubmit}
            />
            <Button
              title={
                mode === 'login'
                  ? 'Pas de compte ? Créer un compte'
                  : "J'ai déjà un compte"
              }
              variant="ghost"
              onPress={() => {
                clearError();
                setMode(mode === 'login' ? 'signup' : 'login');
              }}
            />
          </Card>

          <Button
            title={showConfig ? 'Masquer la configuration' : 'Configurer le serveur'}
            variant="ghost"
            onPress={() => setShowConfig((v) => !v)}
          />
          {showConfig ? (
            <Card>
              <Field
                label="URL du serveur API"
                value={baseUrl}
                onChangeText={setBaseUrl}
                autoCapitalize="none"
                keyboardType="url"
                placeholder="http://10.0.2.2:3001/api"
              />
              <Button
                title="Enregistrer l'URL"
                variant="ghost"
                onPress={() => updateApiBaseUrl(baseUrl)}
              />
            </Card>
          ) : null}

          <Subtitle>
            {'⚡ '}Gratuit en local. Abonnement PRO pour la gestion à distance.
          </Subtitle>
          <View style={{ height: theme.text ? 24 : 0 }} />
        </ScrollView>
      </KeyboardAvoidingView>
    </Screen>
  );
}
