import { useMemo, useState } from 'react';
import {
  Image,
  KeyboardAvoidingView,
  Linking,
  Platform,
  ScrollView,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Constants from 'expo-constants';
import * as Crypto from 'expo-crypto';
import * as AppleAuthentication from 'expo-apple-authentication';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
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

export default function LoginScreen() {
  const {
    login,
    signup,
    appleLogin,
    googleAuthAvailable,
    promptGoogleLogin,
    isBusy,
    error,
    clearError,
    apiBaseUrl,
    updateApiBaseUrl,
  } = useAuth();
  const { t } = useTranslation();
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

  function handleGoogle() {
    clearError();
    promptGoogleLogin();
  }

  async function handleApple() {
    clearError();
    try {
      const credential = await AppleAuthentication.signInAsync({
        requestedScopes: [
          AppleAuthentication.AppleAuthenticationScope.FULL_NAME,
          AppleAuthentication.AppleAuthenticationScope.EMAIL,
        ],
        nonce,
      });
      if (!credential.identityToken) return;
      const fullName = credential.fullName
        ? [credential.fullName.givenName, credential.fullName.familyName]
            .filter(Boolean)
            .join(' ')
        : undefined;
      await appleLogin(credential.identityToken, nonce, fullName || undefined).catch(() => {});
    } catch (e: any) {
      // ERR_REQUEST_CANCELED : l'utilisateur a annulé, pas une erreur à afficher.
      if (e?.code !== 'ERR_REQUEST_CANCELED') throw e;
    }
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
              {mode === 'signup' ? t('login.createAccount') : t('login.welcome')}
            </Text>
          </View>

          {error ? <Banner tone="danger">{error}</Banner> : null}

          <View style={{ gap: space.xl }}>
            {mode === 'signup' ? (
              <OutlinedField
                label={t('login.orgName')}
                value={tenantName}
                onChangeText={setTenantName}
                autoCapitalize="words"
                placeholder={t('login.orgPlaceholder')}
              />
            ) : null}
            <OutlinedField
              label={t('login.email')}
              value={email}
              onChangeText={setEmail}
              keyboardType="email-address"
              autoComplete="email"
              placeholder={t('login.emailPlaceholder')}
            />
            <OutlinedField
              label={t('login.password')}
              value={password}
              onChangeText={setPassword}
              secureTextEntry={!showPassword}
              onToggleSecure={() => setShowPassword((v) => !v)}
              placeholder={mode === 'signup' ? t('login.passwordMinChars') : t('login.passwordPlaceholder')}
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
                  {t('login.forgotPassword')}
                </Text>
              </Press>
            ) : null}
          </View>

          <View style={{ gap: space.lg }}>
            {/* Le Button partagé, pas une pilule maison : le premier écran vu
                par un client doit ressembler au reste de l'app. */}
            <Button
              title={mode === 'signup' ? t('login.submitSignup') : t('login.submitLogin')}
              onPress={submit}
              loading={isBusy}
              disabled={!canSubmit}
            />

            {mode === 'signup' ? (
              <Text
                style={{
                  color: theme.textMuted,
                  fontSize: type.micro,
                  textAlign: 'center',
                }}
              >
                {t('login.signupLegal')}{' '}
                <Text
                  style={{ textDecorationLine: 'underline' }}
                  onPress={() => Linking.openURL('https://api.mikrolan.net/api/legal/terms')}
                >
                  {t('login.termsOfUse')}
                </Text>{' '}
                {t('login.and')}{' '}
                <Text
                  style={{ textDecorationLine: 'underline' }}
                  onPress={() => Linking.openURL('https://api.mikrolan.net/api/legal/privacy')}
                >
                  {t('common.privacyPolicy')}
                </Text>
                .
              </Text>
            ) : null}

            {googleAuthAvailable ? (
              <>
                <View
                  style={{
                    flexDirection: 'row',
                    alignItems: 'center',
                    gap: space.md,
                  }}
                >
                  <View style={{ flex: 1, height: 1, backgroundColor: theme.border }} />
                  <Text style={{ color: theme.textMuted, fontSize: type.micro }}>{t('common.or')}</Text>
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
                    {t('login.continueWithGoogle')}
                  </Text>
                </Press>
              </>
            ) : null}

            {Platform.OS === 'ios' ? (
              <Press
                onPress={handleApple}
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
                <Ionicons name="logo-apple" size={20} color={theme.text} />
                <Text style={{ color: theme.text, fontWeight: '600', fontSize: type.body }}>
                  {t('login.continueWithApple')}
                </Text>
              </Press>
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
                  ? t('login.noAccount')
                  : t('login.hasAccount')}
              </Text>
            </Press>
          </View>

          <View style={{ flex: 1, minHeight: space.md }} />

          <View style={{ gap: space.md }}>
            {__DEV__ ? (
              <>
                <Press onPress={() => setShowConfig((v) => !v)} style={{ alignItems: 'center' }}>
                  <Text style={{ color: theme.textMuted, fontSize: type.micro }}>
                    {showConfig ? t('login.hideConfig') : t('login.configureServer')}
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
                      label={t('login.serverUrl')}
                      value={baseUrl}
                      onChangeText={setBaseUrl}
                      keyboardType="url"
                      placeholder={t('login.serverUrlPlaceholder')}
                    />
                    <Button
                      title={t('login.saveUrl')}
                      variant="ghost"
                      onPress={() => updateApiBaseUrl(baseUrl)}
                    />
                  </View>
                ) : null}
              </>
            ) : null}

            <Text style={{ color: theme.textMuted, fontSize: type.micro, textAlign: 'center' }}>
              {t('common.version', { version: Constants.expoConfig?.version ?? '0.1.0' })}
            </Text>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}
