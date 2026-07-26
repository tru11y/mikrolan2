import { useRef, useState } from 'react';
import { Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { Banner, theme } from '@/src/components/ui';

const CODE_LENGTH = 6;

// UI-only for now: le backend n'a pas d'endpoint de vérification d'e-mail
// (signup connecte directement). Prête à être câblée dès qu'il existera —
// voir échange du 2026-07-26 (autorisation explicite requise côté backend).
export default function VerifyEmailScreen() {
  const router = useRouter();
  const { email } = useLocalSearchParams<{ email?: string }>();
  const [code, setCode] = useState('');
  const [notice, setNotice] = useState(false);
  const hiddenInput = useRef<TextInput | null>(null);

  const canSubmit = code.length === CODE_LENGTH;

  function onChangeCode(value: string) {
    setCode(value.replace(/[^0-9]/g, '').slice(0, CODE_LENGTH));
  }

  return (
    <View style={{ flex: 1, backgroundColor: theme.bg }}>
      <ScrollView
        contentContainerStyle={{
          flexGrow: 1,
          paddingTop: 64,
          paddingHorizontal: 24,
          paddingBottom: 24,
          gap: 28,
        }}
        keyboardShouldPersistTaps="handled"
      >
        <Pressable onPress={() => router.back()} hitSlop={12} style={{ width: 32 }}>
          <Ionicons name="chevron-back" size={26} color={theme.text} />
        </Pressable>

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
            <Ionicons name="mail-open-outline" size={44} color={theme.primaryText} />
          </View>
          <Text style={{ color: theme.text, fontSize: 24, fontWeight: '800', textAlign: 'center' }}>
            Vérifiez votre e-mail
          </Text>
          <Text style={{ color: theme.textMuted, fontSize: 14, textAlign: 'center' }}>
            {email
              ? `Code à 6 chiffres envoyé à ${email}`
              : 'Code à 6 chiffres envoyé à votre adresse e-mail'}
          </Text>
        </View>

        {notice ? (
          <Banner tone="warning">
            Vérification par e-mail — bientôt disponible.
          </Banner>
        ) : null}

        <Pressable
          onPress={() => hiddenInput.current?.focus()}
          style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 10 }}
        >
          {Array.from({ length: CODE_LENGTH }).map((_, i) => {
            const d = code[i] ?? '';
            const active = i === code.length;
            return (
              <View
                key={i}
                style={{
                  flex: 1,
                  height: 56,
                  borderRadius: 14,
                  borderWidth: 1,
                  borderColor: d || active ? theme.primary : theme.border,
                  backgroundColor: theme.surface,
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                <Text
                  style={{
                    color: theme.text,
                    fontSize: 22,
                    fontWeight: '700',
                    fontFamily: theme.mono,
                  }}
                >
                  {d}
                </Text>
              </View>
            );
          })}
          <TextInput
            ref={hiddenInput}
            value={code}
            onChangeText={onChangeCode}
            keyboardType="number-pad"
            maxLength={CODE_LENGTH}
            autoFocus
            style={{ position: 'absolute', opacity: 0, height: 1, width: 1 }}
          />
        </Pressable>

        <View style={{ gap: 16 }}>
          <Pressable
            onPress={() => setNotice(true)}
            disabled={!canSubmit}
            style={{
              height: 54,
              borderRadius: 27,
              backgroundColor: theme.primary,
              opacity: canSubmit ? 1 : 0.6,
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <Text style={{ color: theme.primaryText, fontWeight: '700', fontSize: 16 }}>
              Vérifier
            </Text>
          </Pressable>

          <Pressable onPress={() => setNotice(true)} style={{ alignItems: 'center' }}>
            <Text style={{ color: theme.primary, fontWeight: '700', fontSize: 14 }}>
              Vous n&rsquo;avez rien reçu ? Renvoyer le code
            </Text>
          </Pressable>
        </View>
      </ScrollView>
    </View>
  );
}
