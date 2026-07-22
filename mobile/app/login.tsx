import { useState } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from '@/src/providers/auth-provider';
import {
  Badge,
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
  const [showPassword, setShowPassword] = useState(false);
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
          {/* Brand mark */}
          <View style={{ alignItems: 'center', gap: 12 }}>
            <View
              style={{
                width: 64,
                height: 64,
                borderRadius: 32,
                backgroundColor: theme.primary,
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <Ionicons name="wifi" size={30} color={theme.primaryText} />
            </View>
            <View style={{ alignItems: 'center', gap: 4 }}>
              <Title>{mode === 'login' ? 'Bienvenue' : 'Créer un compte'}</Title>
              <Subtitle>
                {mode === 'login'
                  ? 'Gérez vos hotspots MikroTik'
                  : 'Commencez gratuitement en local'}
              </Subtitle>
            </View>
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
              label="E-mail"
              placeholder="vous@exemple.ci"
              value={email}
              onChangeText={setEmail}
              autoCapitalize="none"
              keyboardType="email-address"
              autoComplete="email"
            />
            <View style={{ gap: 6 }}>
              <View
                style={{
                  flexDirection: 'row',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                }}
              >
                <Text style={{ color: theme.textMuted, fontSize: 13, fontWeight: '600' }}>
                  Mot de passe
                </Text>
                <Pressable onPress={() => setShowPassword((v) => !v)} hitSlop={8}>
                  <Text style={{ color: theme.primary, fontSize: 13, fontWeight: '600' }}>
                    {showPassword ? 'Masquer' : 'Afficher'}
                  </Text>
                </Pressable>
              </View>
              <Field
                placeholder={mode === 'signup' ? '10 caractères minimum' : '••••••••'}
                value={password}
                onChangeText={setPassword}
                secureTextEntry={!showPassword}
              />
            </View>
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

          <View
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 8,
            }}
          >
            <Subtitle>Gratuit en local ·</Subtitle>
            <Badge label="PRO" tone="gold" />
            <Subtitle>pour le distant</Subtitle>
          </View>
          <View style={{ height: 24 }} />
        </ScrollView>
      </KeyboardAvoidingView>
    </Screen>
  );
}
