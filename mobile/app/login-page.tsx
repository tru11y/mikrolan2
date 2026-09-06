import { useEffect, useState } from 'react';
import { ScrollView, Text, View } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { api, extractErrorMessage } from '@/src/lib/api';
import {
  Banner,
  Button,
  Card,
  Field,
  Label,
  space,
  Subtitle,
} from '@/src/components/ui';
import { useTheme } from '@/src/providers/theme-provider';
import { BottomNav, useBottomNavHeight } from '@/src/components/BottomNav';
import { AppHeader } from '@/src/components/AppHeader';

export default function LoginPageScreen() {
  const theme = useTheme();
  const { t } = useTranslation();
  const navHeight = useBottomNavHeight();
  const { routerId } = useLocalSearchParams<{ routerId: string }>();

  const query = useQuery({
    queryKey: ['hotspot-settings', routerId],
    queryFn: () => api.routers.getHotspotSettings(routerId),
    enabled: Boolean(routerId),
  });

  const [dnsName, setDnsName] = useState('');
  const [idleTimeout, setIdleTimeout] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ tone: 'success' | 'danger'; text: string } | null>(null);

  useEffect(() => {
    if (query.data) {
      setDnsName(query.data.dnsName ?? '');
      setIdleTimeout(
        query.data.idleTimeoutMinutes != null
          ? String(query.data.idleTimeoutMinutes)
          : '',
      );
    }
  }, [query.data]);

  async function save() {
    setBusy(true);
    setMsg(null);
    try {
      const payload: { dnsName?: string | null; idleTimeoutMinutes?: number | null } = {};
      const trimmed = dnsName.trim();
      payload.dnsName = trimmed || null;
      const mins = parseInt(idleTimeout, 10);
      payload.idleTimeoutMinutes = Number.isFinite(mins) && mins > 0 ? mins : null;
      await api.routers.updateHotspotSettings(routerId, payload);
      setMsg({ tone: 'success', text: t('loginPage.saved') });
    } catch (e) {
      setMsg({ tone: 'danger', text: extractErrorMessage(e) });
    } finally {
      setBusy(false);
    }
  }

  return (
    <View style={{ flex: 1, backgroundColor: theme.bg }}>
      <AppHeader title={t('loginPage.screenTitle')} back />
      <ScrollView
        contentContainerStyle={{
          gap: space.lg,
          padding: space.lg,
          paddingBottom: navHeight,
        }}
      >
        <Subtitle>{t('loginPage.subtitle')}</Subtitle>

        {/* DNS Name */}
        <Card style={{ gap: 12, padding: 16 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <Ionicons name="globe-outline" size={18} color={theme.primary} />
            <Label>{t('loginPage.dnsNameLabel')}</Label>
          </View>
          <Text style={{ color: theme.textMuted, fontSize: 12, lineHeight: 18 }}>
            {t('loginPage.dnsNameHelp')}
          </Text>
          <Field
            value={dnsName}
            onChangeText={setDnsName}
            placeholder={t('loginPage.dnsNamePlaceholder')}
            autoCapitalize="none"
            keyboardType="url"
          />
        </Card>

        {/* Idle Timeout */}
        <Card style={{ gap: 12, padding: 16 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <Ionicons name="timer-outline" size={18} color={theme.warning} />
            <Label>{t('loginPage.idleTimeoutLabel')}</Label>
          </View>
          <Text style={{ color: theme.textMuted, fontSize: 12, lineHeight: 18 }}>
            {t('loginPage.idleTimeoutHelp')}
          </Text>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <Field
              value={idleTimeout}
              onChangeText={setIdleTimeout}
              placeholder="5"
              keyboardType="numeric"
              style={{ flex: 1 }}
            />
            <Text style={{ color: theme.textMuted, fontSize: 13 }}>
              {t('loginPage.minutes')}
            </Text>
          </View>
        </Card>

        {msg ? <Banner tone={msg.tone}>{msg.text}</Banner> : null}

        <Button
          title={t('loginPage.save')}
          onPress={save}
          loading={busy}
        />
      </ScrollView>
      <BottomNav active="index" />
    </View>
  );
}
