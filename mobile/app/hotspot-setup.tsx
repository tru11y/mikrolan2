import { useState } from 'react';
import { ScrollView, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { api, extractErrorMessage } from '@/src/lib/api';
import {
  Banner,
  Button,
  Card,
  Field,
  Label,
  space,
  Subtitle,
  theme,
  Title,
} from '@/src/components/ui';
import { BottomNav, useBottomNavHeight } from '@/src/components/BottomNav';
import { AppHeader } from '@/src/components/AppHeader';

export default function HotspotSetupScreen() {
  const { t } = useTranslation();
  const navHeight = useBottomNavHeight();
  const router = useRouter();
  const { routerId, onboarding } = useLocalSearchParams<{
    routerId: string;
    onboarding?: string;
  }>();
  const [iface, setIface] = useState('');
  const [network, setNetwork] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  async function configure() {
    setError(null);
    setDone(null);
    if (!iface.trim()) {
      setError(t('hotspotSetup.interfaceRequired'));
      return;
    }
    setBusy(true);
    try {
      const res = await api.routers.configureHotspot(routerId, {
        interface: iface.trim(),
        network: network.trim() || undefined,
      });
      setDone(t('hotspotSetup.hotspotConfigured', { gateway: res.gateway, network: res.network }));
    } catch (e) {
      setError(extractErrorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <View style={{ flex: 1, backgroundColor: theme.bg }}>
      <AppHeader title={t('hotspotSetup.title')} back />
      <ScrollView
        contentContainerStyle={{ gap: space.lg, padding: space.lg, paddingBottom: navHeight }}
      >
                <Banner tone="warning">
          {t('hotspotSetup.warning')}
        </Banner>

        {error ? <Banner tone="danger">{error}</Banner> : null}
        {done ? <Banner tone="success">{done}</Banner> : null}

        <Card>
          <Field
            label={t('hotspotSetup.interface')}
            value={iface}
            onChangeText={setIface}
            placeholder={t('hotspotSetup.interfacePlaceholder')}
            autoCapitalize="none"
          />
          <Field
            label={t('hotspotSetup.network')}
            value={network}
            onChangeText={setNetwork}
            placeholder={t('hotspotSetup.networkPlaceholder')}
            autoCapitalize="none"
          />
          <Subtitle>
            {t('hotspotSetup.defaultNetwork')}
          </Subtitle>
          <Button title={t('hotspotSetup.configure')} onPress={configure} loading={busy} />
          {done && onboarding === '1' ? (
            <Button
              title={t('hotspotSetup.continueCreatePlan')}
              onPress={() =>
                router.replace({
                  pathname: '/plans',
                  params: { routerId, onboarding: '1' },
                })
              }
            />
          ) : null}
        </Card>
      </ScrollView>
      <BottomNav active="index" />
    </View>
  );
}
