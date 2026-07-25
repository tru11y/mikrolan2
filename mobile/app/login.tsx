import { useState } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import Constants from 'expo-constants';
import { useAuth } from '@/src/providers/auth-provider';
import { Banner, Button, theme } from '@/src/components/ui';

// Outlined field with a floating label notched into the top border —
// matches the real app's input style (verified from device screenshots,
// not the approximate reference code dump).
function OutlinedField({
  label,
  value,
  onChangeText,
  secureTextEntry,
  onToggleSecure,
  autoCapitalize,
  keyboardType,
  autoComplete,
  placeholder,
}: {
  label: string;
  value: string;
  onChangeText: (v: string) => void;
  secureTextEntry?: boolean;
  onToggleSecure?: () => void;
  autoCapitalize?: 'none' | 'words';
  keyboardType?: 'default' | 'email-address' | 'url';
  autoComplete?: 'email';
  placeholder?: string;
}) {
  return (
    <View>
      <View
        style={{
          position: 'absolute',
          top: -8,
          left: 12,
          backgroundColor: theme.bg,
          paddingHorizontal: 6,
          zIndex: 1,
        }}
      >
        <Text style={{ color: theme.textMuted, fontSize: 12 }}>{label}</Text>
      </View>
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          borderWidth: 1,
          borderColor: theme.border,
          borderRadius: 14,
          paddingHorizontal: 16,
        }}
      >
        <TextInput
          value={value}
          onChangeText={onChangeText}
          placeholder={placeholder}
          placeholderTextColor={theme.textMuted}
          secureTextEntry={secureTextEntry}
          autoCapitalize={autoCapitalize ?? 'none'}
          keyboardType={keyboardType}
          autoComplete={autoComplete}
          style={{
            flex: 1,
            color: theme.text,
            fontSize: 16,
            fontWeight: '600',
            paddingVertical: 16,
          }}
        />
        {onToggleSecure ? (
          <Pressable onPress={onToggleSecure} hitSlop={10}>
            <Ionicons
              name={secureTextEntry ? 'eye-outline' : 'eye-off-outline'}
              size={20}
              color={theme.textMuted}
            />
          </Pressable>
        ) : null}
      </View>
    </View>
  );
}

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
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={{ flex: 1 }}
      >
        <ScrollView
          contentContainerStyle={{
            flexGrow: 1,
            paddingTop: insets.top + 48,
            paddingHorizontal: 24,
            paddingBottom: 24 + insets.bottom,
            gap: 28,
          }}
          keyboardShouldPersistTaps="handled"
        >
          <View style={{ alignItems: 'center', gap: 16 }}>
            <View
              style={{
                width: 96,
                height: 96,
                borderRadius: 48,
                backgroundColor: theme.primary,
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <Ionicons name="ticket" size={44} color={theme.primaryText} />
            </View>
            <Text style={{ color: theme.text, fontSize: 28, fontWeight: '800' }}>
              {mode === 'signup' ? 'Créer un compte' : 'Bienvenue'}
            </Text>
          </View>

          {error ? <Banner tone="danger">{error}</Banner> : null}

          <View style={{ gap: 20 }}>
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
          </View>

          <View style={{ gap: 16 }}>
            <Pressable
              onPress={submit}
              disabled={!canSubmit || isBusy}
              style={{
                height: 54,
                borderRadius: 27,
                backgroundColor: theme.primary,
                opacity: !canSubmit || isBusy ? 0.6 : 1,
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <Text style={{ color: theme.primaryText, fontWeight: '700', fontSize: 16 }}>
                {isBusy
                  ? 'Patientez…'
                  : mode === 'signup'
                    ? 'Créer mon compte'
                    : 'Se connecter'}
              </Text>
            </Pressable>

            <Pressable
              onPress={() => {
                clearError();
                setMode(mode === 'login' ? 'signup' : 'login');
              }}
              style={{ alignItems: 'center' }}
            >
              <Text style={{ color: theme.primary, fontWeight: '700', fontSize: 14 }}>
                {mode === 'login'
                  ? 'Pas de compte ? Créer un compte'
                  : "J'ai déjà un compte"}
              </Text>
            </Pressable>
          </View>

          <View style={{ flex: 1, minHeight: 12 }} />

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

            <Text style={{ color: theme.textMuted, fontSize: 11, textAlign: 'center' }}>
              MikroLan2 v{Constants.expoConfig?.version ?? '0.1.0'}
            </Text>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}
