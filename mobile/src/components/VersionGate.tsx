import { useEffect, useState } from 'react';
import { BackHandler, ScrollView, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { usePathname, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { useVersionPolicy } from '@/src/hooks/use-version-policy';
import { Button, Card, Press, Row, icon, radius, space, type, withAlpha } from './ui';
import { useTheme } from '@/src/providers/theme-provider';

// L'écran de téléchargement doit rester atteignable même bloqué : c'est la seule issue.
const DOWNLOAD_ROUTE = '/app-download';

function InfoRow({ label, value }: { label: string; value: string }) {
  const theme = useTheme();
  return (
    <Row style={{ justifyContent: 'space-between', paddingVertical: 4 }}>
      <Text style={{ color: theme.textMuted, fontSize: type.body }}>{label}</Text>
      <Text style={{ color: theme.text, fontSize: type.body, fontWeight: '700' }}>{value}</Text>
    </Row>
  );
}

/**
 * Contrôle de version global, monté une fois au-dessus de la navigation (comme PaywallLock).
 * `blocked` : écran plein écran, seul le téléchargement reste accessible.
 * `update`  : bannière dismissible, réaffichée à chaque démarrage.
 *
 * Ce n'est qu'un miroir côté client : l'API n'impose pas la version. Un client modifié
 * pourrait contourner cet écran (voir l'application d'un en-tête de version côté serveur).
 */
export function VersionGate() {
  const theme = useTheme();
  const { t } = useTranslation();
  const router = useRouter();
  const pathname = usePathname();
  const insets = useSafeAreaInsets();
  const { decision, policy, installedCode, fromCache, isFetching, refetch } = useVersionPolicy();
  const [dismissed, setDismissed] = useState(false);

  const onDownloadScreen = pathname.startsWith(DOWNLOAD_ROUTE);
  const blockedVisible = decision === 'blocked' && !onDownloadScreen;
  const bannerVisible =
    decision === 'update' && !dismissed && !onDownloadScreen && !pathname.startsWith('/login');

  // Back Android : l'overlay couvre l'écran, le retour natif naviguerait dessous sans le fermer.
  useEffect(() => {
    if (!blockedVisible) return;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => true);
    return () => sub.remove();
  }, [blockedVisible]);

  if (blockedVisible) {
    return (
      <View
        style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: theme.bg, zIndex: 100 }}
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
                backgroundColor: withAlpha(theme.danger, 0.13),
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <Ionicons name="cloud-download-outline" size={32} color={theme.danger} />
            </View>
            <Text style={{ color: theme.text, fontSize: type.h1, fontWeight: '800', textAlign: 'center' }}>
              {t('versionGate.requiredTitle')}
            </Text>
            <Text style={{ color: theme.textMuted, fontSize: type.bodyLg, textAlign: 'center' }}>
              {t('versionGate.requiredDetail')}
            </Text>
          </View>

          <Card style={{ gap: space.xs }}>
            <InfoRow label={t('versionGate.installed')} value={String(installedCode ?? '—')} />
            <InfoRow label={t('versionGate.minimum')} value={String(policy?.minVersionCode ?? '—')} />
            <InfoRow
              label={t('versionGate.latest')}
              value={policy ? `${policy.versionName ? `v${policy.versionName} ` : ''}(${policy.versionCode})` : '—'}
            />
          </Card>

          <View style={{ gap: space.md }}>
            <Button title={t('versionGate.download')} onPress={() => router.push(DOWNLOAD_ROUTE)} />
            <Button
              title={t('versionGate.recheck')}
              variant="ghost"
              loading={isFetching}
              onPress={() => void refetch()}
            />
          </View>

          {fromCache ? (
            <Text style={{ color: theme.textMuted, fontSize: type.micro, textAlign: 'center' }}>
              {t('versionGate.cachedNote')}
            </Text>
          ) : null}
        </ScrollView>
      </View>
    );
  }

  if (!bannerVisible || !policy) return null;

  return (
    <View
      pointerEvents="box-none"
      style={{ position: 'absolute', top: insets.top + space.sm, left: space.md, right: space.md, zIndex: 90 }}
    >
      <Row
        style={{
          gap: space.sm,
          alignItems: 'center',
          backgroundColor: theme.surface,
          borderRadius: radius.lg,
          borderWidth: 1,
          borderColor: withAlpha(theme.warning, 0.5),
          padding: space.md,
        }}
      >
        <Ionicons name="arrow-up-circle-outline" size={icon.md} color={theme.warning} />
        <View style={{ flex: 1 }}>
          <Text style={{ color: theme.text, fontSize: type.body, fontWeight: '700' }}>
            {t('versionGate.bannerTitle')}
          </Text>
          <Text style={{ color: theme.textMuted, fontSize: type.caption }}>
            {t('versionGate.bannerDetail', { version: policy.versionName || String(policy.versionCode) })}
          </Text>
        </View>
        <Press accessibilityLabel={t('versionGate.bannerAction')} onPress={() => router.push(DOWNLOAD_ROUTE)}>
          <Text style={{ color: theme.primary, fontSize: type.body, fontWeight: '700' }}>
            {t('versionGate.bannerAction')}
          </Text>
        </Press>
        <Press accessibilityLabel={t('versionGate.dismiss')} onPress={() => setDismissed(true)}>
          <Ionicons name="close" size={icon.md} color={theme.textMuted} />
        </Press>
      </Row>
    </View>
  );
}
