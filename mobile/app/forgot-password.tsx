import { useState } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { api, extractErrorMessage } from '@/src/lib/api';
import {
  Banner,
  Button,
  OutlinedField,
  Screen,
  icon,
  radius,
  space,
  theme,
  type,
} from '@/src/components/ui';

/** Header minimal, sans requête `/auth/me` — cet écran est accessible déconnecté. */
function UnauthHeader({ title }: { title: string }) {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  return (
    <View
      style={{
        paddingTop: insets.top,
        backgroundColor: theme.surface,
        borderBottomWidth: 1,
        borderBottomColor: theme.border,
      }}
    >
      <View
        style={{
          height: 56,
          paddingHorizontal: space.lg,
          flexDirection: 'row',
          alignItems: 'center',
          gap: space.sm,
        }}
      >
        <Pressable
          accessibilityLabel="Retour"
          onPress={() => router.back()}
          hitSlop={8}
          style={{
            width: 34,
            height: 34,
            borderRadius: radius.md,
            borderWidth: 1,
            borderColor: theme.border,
            backgroundColor: theme.surfaceAlt,
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <Ionicons name="chevron-back" size={icon.md} color={theme.text} />
        </Pressable>
        <Text style={{ color: theme.text, fontWeight: '800', fontSize: type.bodyLg }}>
          {title}
        </Text>
      </View>
    </View>
  );
}

export default function ForgotPasswordScreen() {
  const router = useRouter();
  const [step, setStep] = useState<'request' | 'confirm'>('request');
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  async function requestCode() {
    setError(null);
    setBusy(true);
    try {
      await api.auth.requestPasswordReset(email.trim().toLowerCase());
      setStep('confirm');
    } catch (e) {
      setError(extractErrorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  async function confirmReset() {
    setError(null);
    setBusy(true);
    try {
      await api.auth.confirmPasswordReset(
        email.trim().toLowerCase(),
        code.trim(),
        newPassword,
      );
      setDone(true);
    } catch (e) {
      setError(extractErrorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  const canRequest = email.trim().length > 3;
  const canConfirm = /^\d{6}$/.test(code.trim()) && newPassword.length >= 12;

  if (done) {
    return (
      <View style={{ flex: 1, backgroundColor: theme.bg }}>
        <UnauthHeader title="Mot de passe réinitialisé" />
        <Screen>
          <View style={{ padding: space.lg, gap: space.lg }}>
            <Banner tone="success">
              Ton mot de passe a été mis à jour. Connecte-toi avec le nouveau.
            </Banner>
            <Button title="Retour à la connexion" onPress={() => router.replace('/login')} />
          </View>
        </Screen>
      </View>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: theme.bg }}>
      <UnauthHeader title="Mot de passe oublié" />
      <Screen>
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          style={{ flex: 1 }}
        >
          <ScrollView
            contentContainerStyle={{ padding: space.lg, gap: space.xl }}
            keyboardShouldPersistTaps="handled"
          >
            {error ? <Banner tone="danger">{error}</Banner> : null}

            {step === 'request' ? (
              <>
                <Text style={{ color: theme.textMuted, fontSize: type.body }}>
                  Entre ton e-mail, on t'envoie un code à 6 chiffres.
                </Text>
                <OutlinedField
                  label="E-mail"
                  value={email}
                  onChangeText={setEmail}
                  keyboardType="email-address"
                  autoComplete="email"
                  autoCapitalize="none"
                  placeholder="vous@exemple.ci"
                />
                <Button
                  title="Envoyer le code"
                  onPress={requestCode}
                  loading={busy}
                  disabled={!canRequest}
                />
              </>
            ) : (
              <>
                <Text style={{ color: theme.textMuted, fontSize: type.body }}>
                  Code envoyé à {email}. Entre-le avec ton nouveau mot de passe.
                </Text>
                <OutlinedField
                  label="Code à 6 chiffres"
                  value={code}
                  onChangeText={(v) => setCode(v.replace(/\D/g, '').slice(0, 6))}
                  keyboardType="number-pad"
                  placeholder="123456"
                />
                <OutlinedField
                  label="Nouveau mot de passe"
                  value={newPassword}
                  onChangeText={setNewPassword}
                  secureTextEntry={!showPassword}
                  onToggleSecure={() => setShowPassword((v) => !v)}
                  placeholder="12 caractères minimum"
                />
                <Button
                  title="Réinitialiser le mot de passe"
                  onPress={confirmReset}
                  loading={busy}
                  disabled={!canConfirm}
                />
                <Button
                  title="Renvoyer le code"
                  variant="ghost"
                  onPress={requestCode}
                  loading={busy}
                />
              </>
            )}
          </ScrollView>
        </KeyboardAvoidingView>
      </Screen>
    </View>
  );
}
