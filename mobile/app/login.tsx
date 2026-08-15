import { useEffect, useMemo, useState } from 'react';
import {
  Image,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Constants from 'expo-constants';
import * as Crypto from 'expo-crypto';
import * as Google from 'expo-auth-session/providers/google';
import * as WebBrowser from 'expo-web-browser';
import { useRouter } from 'expo-router';
import { useAuth } from '@/src/providers/auth-provider';
import { Ionicons } from '@expo/vector-icons';
import {
  Banner,
  Button,
  OutlinedField,
  Press,
  radius,
  space,
  theme,
  type,
} from '@/src/components/ui';

WebBrowser.maybeCompleteAuthSession();

const GOOGLE_WEB_CLIENT_ID = Constants.expoConfig?.extra?.googleWebClientId as string | undefined;
const GOOGLE_ANDROID_CLIENT_ID = Constants.expoConfig?.extra?.googleAndroidClientId as string | undefined;

export default function LoginScreen() {
  const { login, signup, googleLogin, isBusy, error, clearError, apiBaseUrl, updateApiBaseUrl } =
    useAuth();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [mode, setMode] = useState<'login' | 'signup'>('login');
  const [tenantName, setTenantName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [showConfig, setShowConfig] = useState(false);
  const [baseUrl, setBaseUrl] = useState(apiBaseUrl);

  const nonce = useMemo(() => Crypto.randomUUID(), []);
  const [nonceHash, setNonceHash] = useState<string | null>(null);

  useEffect(() => {
    Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, nonce).then(
      setNonceHash,
    );
  }, [nonce]);

  const [, googleResponse, promptGoogle] = Google.useIdTokenAuthRequest({
    clientId: GOOGLE_WEB_CLIENT_ID,
    androidClientId: GOOGLE_ANDROID_CLIENT_ID,
    extraParams: nonceHash ? { nonce: nonceHash } : undefined,
  });

  useEffect(() => {
    if (googleResponse?.type === 'success') {
      const idToken = googleResponse.params.id_token;
      if (idToken) {
        googleLogin(idToken, nonce).catch(() => {});
      }
    }
  }, [googleResponse]);

  function handleGoogle() {
    clearError();
    promptGoogle();
  }

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
    <View style={{ flex: 1, backgroundColor: theme.bg }}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={{ flex: 1 }}
      >
        <ScrollView
          contentContainerStyle={{
            flexGrow: 1,
            paddingTop: insets.top + space.xxxl + space.lg,
            paddingHorizontal: space.xxl,
            paddingBottom: space.xxl + insets.bottom,
            gap: space.xxl + space.xs,
          }}
          keyboardShouldPersistTaps="handled"
        >
          <View style={{ alignItems: 'center', gap: space.lg }}>
            <Image
              source={require('@/assets/images/logo.png')}
              style={{ width: 96, height: 96 }}
              resizeMode="contain"
            />
            <Text style={{ color: theme.text, fontSize: type.display, fontWeight: '800' }}>
              {mode === 'signup' ? 'Créer un compte' : 'Bienvenue'}
            </Text>
          </View>

          {error ? <Banner tone="danger">{error}</Banner> : null}

          <View style={{ gap: space.xl }}>
            {mode === 'signup' ? (
              <OutlinedField
                label="Nom de l'organisation"
                value={tenantName}
                onChangeText={setTenantName}
                autoCapitalize="words"
                placeholder="Mon ISP"
              />
            ) : null}
            <OutlinedField
              label="E-mail"
              value={email}
              onChangeText={setEmail}
              keyboardType="email-address"
              autoComplete="email"
              placeholder="vous@exemple.ci"
            />
            <OutlinedField
              label="Mot de passe"
              value={password}
              onChangeText={setPassword}
              secureTextEntry={!showPassword}
              onToggleSecure={() => setShowPassword((v) => !v)}
              placeholder={mode === 'signup' ? '10 caractères minimum' : '••••••••'}
            />
            {mode === 'login' ? (
              <Press
                onPress={() => {
                  clearError();
                  router.push('/forgot-password');
                }}
              >
                <Text
                  style={{
                    color: theme.textMuted,
                    fontWeight: '600',
                    fontSize: type.micro,
                    textAlign: 'right',
                  }}
                >
                  Mot de passe oublié ?
                </Text>
              </Press>
            ) : null}
          </View>

          <View style={{ gap: space.lg }}>
            {/* Le Button partagé, pas une pilule maison : le premier écran vu
                par un client doit ressembler au reste de l'app. */}
            <Button
              title={mode === 'signup' ? 'Créer mon compte' : 'Se connecter'}
              onPress={submit}
              loading={isBusy}
              disabled={!canSubmit}
            />

            {GOOGLE_WEB_CLIENT_ID ? (
              <>
                <View
                  style={{
                    flexDirection: 'row',
                    alignItems: 'center',
                    gap: space.md,
                  }}
                >
                  <View style={{ flex: 1, height: 1, backgroundColor: theme.border }} />
                  <Text style={{ color: theme.textMuted, fontSize: type.micro }}>ou</Text>
                  <View style={{ flex: 1, height: 1, backgroundColor: theme.border }} />
                </View>
                <Press
                  onPress={handleGoogle}
                  disabled={isBusy}
                  style={{
                    flexDirection: 'row',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: space.sm,
                    height: 48,
                    borderRadius: radius.lg,
                    borderWidth: 1,
                    borderColor: theme.border,
                    backgroundColor: theme.surface,
                    opacity: isBusy ? 0.5 : 1,
                  }}
                >
                  <Ionicons name="logo-google" size={20} color={theme.text} />
                  <Text style={{ color: theme.text, fontWeight: '600', fontSize: type.body }}>
                    Continuer avec Google
                  </Text>
                </Press>
              </>
            ) : null}

            <Press
              onPress={() => {
                clearError();
                setMode(mode === 'login' ? 'signup' : 'login');
              }}
              style={{ alignItems: 'center' }}
            >
              <Text
                style={{
                  color: theme.primary,
                  fontWeight: '700',
                  fontSize: type.body,
                }}
              >
                {mode === 'login'
                  ? 'Pas de compte ? Créer un compte'
                  : "J'ai déjà un compte"}
              </Text>
            </Press>
          </View>

          <View style={{ flex: 1, minHeight: space.md }} />

          <View style={{ gap: space.md }}>
            {__DEV__ ? (
              <>
                <Press onPress={() => setShowConfig((v) => !v)} style={{ alignItems: 'center' }}>
                  <Text style={{ color: theme.textMuted, fontSize: type.micro }}>
                    {showConfig ? 'Masquer la configuration' : 'Configurer le serveur'}
                  </Text>
                </Press>
                {showConfig ? (
                  <View
                    style={{
                      backgroundColor: theme.surface,
                      borderWidth: 1,
                      borderColor: theme.border,
                      borderRadius: radius.lg,
                      padding: space.lg,
                      gap: space.sm + 2,
                    }}
                  >
                    <OutlinedField
                      label="URL du serveur API"
                      value={baseUrl}
                      onChangeText={setBaseUrl}
                      keyboardType="url"
                      placeholder="http://10.0.2.2:3001/api"
                    />
                    <Button
                      title="Enregistrer l'URL"
                      variant="ghost"
                      onPress={() => updateApiBaseUrl(baseUrl)}
                    />
                  </View>
                ) : null}
              </>
            ) : null}

            <Text style={{ color: theme.textMuted, fontSize: type.micro, textAlign: 'center' }}>
              MikroLan2 v{Constants.expoConfig?.version ?? '0.1.0'}
            </Text>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}
