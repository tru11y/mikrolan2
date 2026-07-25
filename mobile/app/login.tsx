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
import { LinearGradient } from 'expo-linear-gradient';
import Constants from 'expo-constants';
import { useAuth } from '@/src/providers/auth-provider';
import { Banner, Button, Field, theme } from '@/src/components/ui';

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
    <View style={{ flex: 1, backgroundColor: theme.bg }}>
      {/* Ambient glow — mirrors the reference's two blurred background circles */}
      <View pointerEvents="none" style={{ position: 'absolute', inset: 0, overflow: 'hidden' }}>
        <LinearGradient
          colors={[theme.primary + '26', theme.primary + '00']}
          style={{
            position: 'absolute',
            top: -140,
            left: '50%',
            marginLeft: -190,
            width: 380,
            height: 380,
            borderRadius: 190,
          }}
        />
        <LinearGradient
          colors={[theme.secondary + '22', theme.secondary + '00']}
          style={{
            position: 'absolute',
            bottom: -100,
            right: -100,
            width: 320,
            height: 320,
            borderRadius: 160,
          }}
        />
      </View>

      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={{ flex: 1 }}
      >
        <ScrollView
          contentContainerStyle={{
            flexGrow: 1,
            paddingTop: insets.top + 32,
            paddingHorizontal: 24,
            paddingBottom: 16 + insets.bottom,
            justifyContent: 'space-between',
            gap: 24,
          }}
          keyboardShouldPersistTaps="handled"
        >
          {/* Brand header */}
          <View style={{ alignItems: 'center', gap: 4 }}>
            <LinearGradient
              colors={[theme.primary, theme.secondary]}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
              style={{
                width: 80,
                height: 80,
                borderRadius: 24,
                alignItems: 'center',
                justifyContent: 'center',
                marginBottom: 16,
              }}
            >
              <Ionicons name="wifi" size={40} color="#fff" />
            </LinearGradient>
            <Text
              style={{
                color: theme.text,
                fontSize: 30,
                fontWeight: '800',
                letterSpacing: -0.5,
              }}
            >
              MikroLan2
            </Text>
            <Text
              style={{
                color: theme.textMuted,
                fontSize: 14,
                textAlign: 'center',
                maxWidth: 260,
                marginTop: 4,
              }}
            >
              Monétisation WiFi intelligente pour routeurs MikroTik
            </Text>
          </View>

          {/* Auth card */}
          <View
            style={{
              backgroundColor: theme.surface,
              borderWidth: 1,
              borderColor: theme.border,
              borderRadius: 16,
              padding: 20,
              gap: 16,
            }}
          >
            <View
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                justifyContent: 'space-between',
                paddingBottom: 12,
                borderBottomWidth: 1,
                borderBottomColor: theme.border,
              }}
            >
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                <Ionicons name="shield-checkmark" size={20} color={theme.primary} />
                <Text style={{ color: theme.text, fontWeight: '700', fontSize: 14 }}>
                  {mode === 'signup' ? 'Créer un compte' : 'Connexion'}
                </Text>
              </View>
              <View
                style={{
                  backgroundColor: theme.success + '1A',
                  borderWidth: 1,
                  borderColor: theme.success + '4D',
                  borderRadius: 999,
                  paddingHorizontal: 10,
                  paddingVertical: 2,
                }}
              >
                <Text style={{ color: theme.success, fontSize: 11, fontWeight: '700' }}>
                  v{Constants.expoConfig?.version ?? '1.0'}
                </Text>
              </View>
            </View>

            {error ? <Banner tone="danger">{error}</Banner> : null}

            <View style={{ gap: 12 }}>
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
                  <Text style={{ color: theme.textMuted, fontSize: 12, fontWeight: '500' }}>
                    Mot de passe
                  </Text>
                  <Pressable onPress={() => setShowPassword((v) => !v)} hitSlop={8}>
                    <Text style={{ color: theme.primary, fontSize: 12, fontWeight: '600' }}>
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
            </View>

            <Pressable
              onPress={submit}
              disabled={!canSubmit || isBusy}
              style={{
                height: 52,
                borderRadius: 12,
                backgroundColor: theme.primary,
                opacity: !canSubmit || isBusy ? 0.6 : 1,
                flexDirection: 'row',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 8,
              }}
            >
              <Text style={{ color: theme.primaryText, fontWeight: '700', fontSize: 16 }}>
                {isBusy
                  ? 'Patientez…'
                  : mode === 'signup'
                    ? 'Créer mon compte'
                    : 'Se connecter'}
              </Text>
              {!isBusy ? (
                <Ionicons name="arrow-forward" size={20} color={theme.primaryText} />
              ) : null}
            </Pressable>

            <Pressable
              onPress={() => {
                clearError();
                setMode(mode === 'login' ? 'signup' : 'login');
              }}
              style={{ alignItems: 'center' }}
            >
              <Text style={{ color: theme.textMuted, fontSize: 13, fontWeight: '600' }}>
                {mode === 'login'
                  ? 'Pas de compte ? Créer un compte'
                  : "J'ai déjà un compte"}
              </Text>
            </Pressable>

            <View
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 16,
                paddingTop: 8,
              }}
            >
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }}>
                <Ionicons name="flash" size={14} color={theme.gold} />
                <Text style={{ color: theme.textMuted, fontSize: 12 }}>Mode Hors-Ligne</Text>
              </View>
              <Text style={{ color: theme.textMuted, fontSize: 12 }}>•</Text>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }}>
                <Ionicons name="hardware-chip-outline" size={14} color={theme.secondary} />
                <Text style={{ color: theme.textMuted, fontSize: 12 }}>RouterOS v6/v7</Text>
              </View>
            </View>
          </View>

          {/* Advanced: API server override (LAN/dev only) */}
          <View style={{ gap: 12 }}>
            <Pressable onPress={() => setShowConfig((v) => !v)} style={{ alignItems: 'center' }}>
              <Text style={{ color: theme.textMuted, fontSize: 11 }}>
                {showConfig ? 'Masquer la configuration' : 'Configurer le serveur'}
              </Text>
            </Pressable>
            {showConfig ? (
              <View
                style={{
                  backgroundColor: theme.surface,
                  borderWidth: 1,
                  borderColor: theme.border,
                  borderRadius: 16,
                  padding: 16,
                  gap: 10,
                }}
              >
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
              </View>
            ) : null}

            <Text style={{ color: theme.textMuted, fontSize: 11, textAlign: 'center' }}>
              Gratuit en local · PRO pour le distant
            </Text>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}
