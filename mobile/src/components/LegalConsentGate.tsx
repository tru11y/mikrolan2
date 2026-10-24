import { useEffect, useState } from 'react';
import { BackHandler, Linking, ScrollView, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { useAuth } from '@/src/providers/auth-provider';
import { useTheme } from '@/src/providers/theme-provider';
import { extractErrorMessage } from '@/src/lib/api';
import { Banner, Button, Press, radius, space, type, withAlpha } from './ui';
import { ConsentCheckbox } from './ConsentCheckbox';

const TERMS_URL = 'https://api.mikrolan.net/api/legal/terms';
const PRIVACY_URL = 'https://api.mikrolan.net/api/legal/privacy';

/**
 * Écran bloquant tant que l'utilisateur connecté n'a pas accepté les versions
 * publiées des CGU et de la politique de confidentialité (comptes antérieurs à la
 * traçabilité, inscriptions Google/Apple, textes mis à jour). Monté une fois au-dessus
 * de la navigation, comme VersionGate. Le serveur enregistre la preuve (date + version).
 */
export function LegalConsentGate() {
  const theme = useTheme();
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const { isAuthenticated, needsLegalConsent, acceptLegal, logout, isBusy } = useAuth();
  const [checked, setChecked] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const visible = isAuthenticated && needsLegalConsent;

  useEffect(() => {
    if (!visible) return;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => true);
    return () => sub.remove();
  }, [visible]);

  if (!visible) return null;

  async function accept() {
    setBusy(true);
    setError(null);
    try {
      await acceptLegal();
    } catch (e) {
      setError(extractErrorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <View
      style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: theme.bg, zIndex: 95 }}
    >
      <ScrollView
        contentContainerStyle={{
          flexGrow: 1,
          justifyContent: 'center',
          padding: space.xxl,
          paddingTop: insets.top + space.xxl,
          paddingBottom: insets.bottom + space.xxl,
          gap: space.xl,
        }}
      >
        <View style={{ alignItems: 'center', gap: space.md }}>
          <View
            style={{
              width: 72,
              height: 72,
              borderRadius: radius.xl,
              backgroundColor: withAlpha(theme.primary, 0.13),
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <Ionicons name="document-text-outline" size={32} color={theme.primary} />
          </View>
          <Text style={{ color: theme.text, fontSize: type.h1, fontWeight: '800', textAlign: 'center' }}>
            {t('legal.consentTitle')}
          </Text>
          <Text style={{ color: theme.textMuted, fontSize: type.bodyLg, textAlign: 'center' }}>
            {t('legal.consentIntro')}
          </Text>
        </View>

        {error ? <Banner tone="danger">{error}</Banner> : null}

        <View style={{ gap: space.md }}>
          <Press accessibilityRole="link" onPress={() => void Linking.openURL(TERMS_URL)}>
            <Text style={{ color: theme.primary, fontSize: type.body, fontWeight: '700' }}>{t('legal.readTerms')}</Text>
          </Press>
          <Press accessibilityRole="link" onPress={() => void Linking.openURL(PRIVACY_URL)}>
            <Text style={{ color: theme.primary, fontSize: type.body, fontWeight: '700' }}>{t('legal.readPrivacy')}</Text>
          </Press>
        </View>

        <ConsentCheckbox
          checked={checked}
          onToggle={() => setChecked((v) => !v)}
          accessibilityLabel={t('legal.consentCheckbox')}
        >
          <Text style={{ color: theme.text, fontSize: type.body }}>{t('legal.consentCheckbox')}</Text>
        </ConsentCheckbox>

        <View style={{ gap: space.md }}>
          <Button title={t('legal.consentAccept')} onPress={() => void accept()} loading={busy} disabled={!checked} />
          <Button title={t('legal.consentLogout')} variant="ghost" onPress={() => void logout()} loading={isBusy} />
        </View>
      </ScrollView>
    </View>
  );
}
