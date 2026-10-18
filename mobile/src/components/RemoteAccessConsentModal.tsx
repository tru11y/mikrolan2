import { useState } from 'react';
import { Linking, Modal, ScrollView, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { useAuth } from '@/src/providers/auth-provider';
import { useTheme } from '@/src/providers/theme-provider';
import { api, extractErrorMessage } from '@/src/lib/api';
import { Banner, Button, Press, space, type } from './ui';
import { ConsentCheckbox } from './ConsentCheckbox';

const REMOTE_ACCESS_URL = 'https://api.mikrolan.net/api/legal/remote-access';

type Props = {
  visible: boolean;
  onClose: () => void;
  /** Appelé une fois l'autorisation enregistrée côté serveur. */
  onAccepted: () => void;
};

/**
 * Autorisation expresse d'accès distant aux routeurs (annexe CGV). Exigée par le serveur
 * avant tout provisionnement WireGuard ; seul le propriétaire du compte peut la donner.
 */
export function RemoteAccessConsentModal({ visible, onClose, onAccepted }: Props) {
  const theme = useTheme();
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const { me, refreshProfile } = useAuth();
  const [checked, setChecked] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isOwner = me?.user.role === 'OWNER' || me?.user.role === 'SUPER_ADMIN';
  const version = me?.legal.remoteAccess;

  async function accept() {
    if (!version) return;
    setBusy(true);
    setError(null);
    try {
      await api.remoteAccess.accept(version);
      await refreshProfile();
      setChecked(false);
      onAccepted();
    } catch (e) {
      setError(extractErrorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <View style={{ flex: 1, backgroundColor: theme.bg }}>
        <ScrollView
          contentContainerStyle={{
            padding: space.xxl,
            paddingTop: insets.top + space.xxl,
            paddingBottom: insets.bottom + space.xxl,
            gap: space.xl,
          }}
        >
          <Text style={{ color: theme.text, fontSize: type.h1, fontWeight: '800' }}>
            {t('legal.remoteTitle')}
          </Text>
          <Text style={{ color: theme.textMuted, fontSize: type.bodyLg }}>{t('legal.remoteBody')}</Text>
          <Press accessibilityRole="link" onPress={() => void Linking.openURL(REMOTE_ACCESS_URL)}>
            <Text style={{ color: theme.primary, fontSize: type.body, fontWeight: '700' }}>
              {t('legal.remoteRead')}
            </Text>
          </Press>

          {error ? <Banner tone="danger">{error}</Banner> : null}

          {isOwner ? (
            <>
              <ConsentCheckbox
                checked={checked}
                onToggle={() => setChecked((v) => !v)}
                accessibilityLabel={t('legal.remoteCheckbox')}
              >
                <Text style={{ color: theme.text, fontSize: type.body }}>{t('legal.remoteCheckbox')}</Text>
              </ConsentCheckbox>
              <Button
                title={t('legal.remoteAccept')}
                onPress={() => void accept()}
                loading={busy}
                disabled={!checked || !version}
              />
            </>
          ) : (
            <Banner tone="warning">{t('legal.remoteOwnerOnly')}</Banner>
          )}
          <Button title={t('legal.remoteCancel')} variant="ghost" onPress={onClose} />
        </ScrollView>
      </View>
    </Modal>
  );
}
