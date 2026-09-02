import { useEffect, useState } from 'react';
import { ScrollView, Switch, Text, View } from 'react-native';
import { WebView } from 'react-native-webview';
import { useLocalSearchParams } from 'expo-router';
import { useTranslation } from 'react-i18next';
import * as ImagePicker from 'expo-image-picker';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  api,
  extractErrorMessage,
  DEFAULT_TICKET_TEMPLATE,
  type TicketTemplate,
} from '@/src/lib/api';
import { buildTicketsHtml } from '@/src/lib/ticketsPdf';
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

function Toggle({
  label,
  value,
  onValueChange,
}: {
  label: string;
  value: boolean;
  onValueChange: (v: boolean) => void;
}) {
  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        paddingVertical: 14,
      }}
    >
      <Text style={{ color: theme.text, fontSize: 14, fontWeight: '600', flex: 1 }}>
        {label}
      </Text>
      <Switch
        value={value}
        onValueChange={onValueChange}
        trackColor={{ false: theme.border, true: theme.primary }}
        thumbColor={theme.onStrong}
      />
    </View>
  );
}

function Divider() {
  return <View style={{ height: 1, backgroundColor: theme.border }} />;
}

export default function TicketSettingsScreen() {
  const { t } = useTranslation();
  const navHeight = useBottomNavHeight();
  const { routerId } = useLocalSearchParams<{ routerId: string }>();
  const qc = useQueryClient();

  const routerQuery = useQuery({
    queryKey: ['router', routerId],
    queryFn: () => api.routers.get(routerId),
    enabled: Boolean(routerId),
  });

  const [tpl, setTpl] = useState<TicketTemplate>(DEFAULT_TICKET_TEMPLATE);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ tone: 'success' | 'danger'; text: string } | null>(
    null,
  );
  const [previewHtml, setPreviewHtml] = useState('');

  useEffect(() => {
    if (routerQuery.data?.ticketTemplate) setTpl(routerQuery.data.ticketTemplate);
  }, [routerQuery.data]);

  // Aperçu en direct : le rendu exact que produira l'impression (même
  // constructeur HTML que ticketsPdf.ts), pas une maquette approximative —
  // sinon l'opérateur configure toujours à l'aveugle, juste avec un dessin
  // en plus qui ne reflète pas les réglages.
  useEffect(() => {
    let cancelled = false;
    void buildTicketsHtml({
      routerName: routerQuery.data?.alias || routerQuery.data?.identity || 'Mon routeur',
      planName: 'Forfait 1 jour',
      durationMinutes: 1440,
      priceXof: 500,
      tickets: [{ code: 'DEMO1234' }],
      template: tpl,
    }).then((html) => {
      if (!cancelled) setPreviewHtml(html);
    });
    return () => {
      cancelled = true;
    };
  }, [tpl, routerQuery.data]);

  function set<K extends keyof TicketTemplate>(key: K, value: TicketTemplate[K]) {
    setTpl((t) => ({ ...t, [key]: value }));
  }

  async function pickLogo() {
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) return;
    const res = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      base64: true,
      quality: 0.5,
    });
    const asset = res.assets?.[0];
    if (asset?.base64) {
      set('logoDataUri', `data:image/jpeg;base64,${asset.base64}`);
    }
  }

  async function save() {
    setBusy(true);
    setMsg(null);
    try {
      await api.routers.updateTicketTemplate(routerId, tpl);
      await qc.invalidateQueries({ queryKey: ['router', routerId] });
      setMsg({ tone: 'success', text: t('ticketSettings.saved') });
    } catch (e) {
      setMsg({ tone: 'danger', text: extractErrorMessage(e) });
    } finally {
      setBusy(false);
    }
  }

  return (
    <View style={{ flex: 1, backgroundColor: theme.bg }}>
      <AppHeader title={t('ticketSettings.screenTitle')} back />
      <ScrollView
        contentContainerStyle={{ padding: space.lg, paddingBottom: navHeight }}
      >
                <Subtitle>{t('ticketSettings.subtitle')}</Subtitle>
        <View style={{ height: 12 }} />

        {msg ? <Banner tone={msg.tone}>{msg.text}</Banner> : null}

        <Card style={{ padding: 0, overflow: 'hidden' }}>
          <View style={{ padding: space.md, paddingBottom: 0 }}>
            <Label>{t('ticketSettings.preview')}</Label>
          </View>
          <View style={{ height: 300 }}>
            {previewHtml ? (
              <WebView
                source={{ html: previewHtml }}
                scrollEnabled={false}
                style={{ backgroundColor: 'transparent' }}
              />
            ) : null}
          </View>
        </Card>
        <View style={{ height: 12 }} />

        <Toggle
          label={t('ticketSettings.showCompanyName')}
          value={tpl.showCompanyName}
          onValueChange={(v) => set('showCompanyName', v)}
        />
        {tpl.showCompanyName ? (
          <View style={{ paddingBottom: 14 }}>
            <Field
              label={t('ticketSettings.companyNameLabel')}
              value={tpl.companyName ?? ''}
              onChangeText={(v) => set('companyName', v)}
              placeholder={t('ticketSettings.companyNamePlaceholder')}
            />
          </View>
        ) : null}
        <Divider />

        <Toggle
          label={t('ticketSettings.showWifiName')}
          value={tpl.showWifiName}
          onValueChange={(v) => set('showWifiName', v)}
        />
        <Divider />

        <Toggle
          label={t('ticketSettings.showPrice')}
          value={tpl.showPrice}
          onValueChange={(v) => set('showPrice', v)}
        />
        {tpl.showPrice ? (
          <View style={{ paddingBottom: 14 }}>
            <Field
              label={t('ticketSettings.currencyLabel')}
              value={tpl.currency}
              onChangeText={(v) => set('currency', v)}
              placeholder="FCFA"
            />
          </View>
        ) : null}
        <Divider />

        <Toggle
          label={t('ticketSettings.showTicketNumber')}
          value={tpl.showTicketNumber}
          onValueChange={(v) => set('showTicketNumber', v)}
        />
        <Divider />

        <Toggle
          label={t('ticketSettings.showQrCode')}
          value={tpl.showQrCode}
          onValueChange={(v) => set('showQrCode', v)}
        />
        <Divider />

        <Toggle
          label={t('ticketSettings.showPlanName')}
          value={tpl.showPlanName}
          onValueChange={(v) => set('showPlanName', v)}
        />
        <Divider />

        <Toggle
          label={t('ticketSettings.showCreatedAt')}
          value={tpl.showCreatedAt}
          onValueChange={(v) => set('showCreatedAt', v)}
        />
        <Divider />

        <Toggle
          label={t('ticketSettings.showPoweredBy')}
          value={tpl.showPoweredBy}
          onValueChange={(v) => set('showPoweredBy', v)}
        />
        <Divider />

        <Toggle
          label={t('ticketSettings.showNote')}
          value={tpl.showNote}
          onValueChange={(v) => set('showNote', v)}
        />
        {tpl.showNote ? (
          <View style={{ paddingBottom: 14 }}>
            <Field
              label={t('ticketSettings.noteLabel')}
              value={tpl.note ?? ''}
              onChangeText={(v) => set('note', v)}
              placeholder={t('ticketSettings.notePlaceholder')}
            />
          </View>
        ) : null}
        <Divider />

        <Toggle
          label={t('ticketSettings.showHeader')}
          value={tpl.showHeader}
          onValueChange={(v) => set('showHeader', v)}
        />
        {tpl.showHeader ? (
          <View style={{ paddingBottom: 14 }}>
            <Field
              label={t('ticketSettings.headerLabel')}
              value={tpl.header ?? ''}
              onChangeText={(v) => set('header', v)}
            />
          </View>
        ) : null}
        <Divider />

        <Toggle
          label={t('ticketSettings.showFooter')}
          value={tpl.showFooter}
          onValueChange={(v) => set('showFooter', v)}
        />
        {tpl.showFooter ? (
          <View style={{ paddingBottom: 14 }}>
            <Field
              label={t('ticketSettings.footerLabel')}
              value={tpl.footer ?? ''}
              onChangeText={(v) => set('footer', v)}
            />
          </View>
        ) : null}
        <Divider />

        <Toggle
          label={t('ticketSettings.showPageNumber')}
          value={tpl.showPageNumber}
          onValueChange={(v) => set('showPageNumber', v)}
        />
        <Divider />

        <Toggle
          label={t('ticketSettings.showLogo')}
          value={tpl.showLogo}
          onValueChange={(v) => set('showLogo', v)}
        />
        {tpl.showLogo ? (
          <View style={{ paddingBottom: 14 }}>
            <Button
              title={tpl.logoDataUri ? t('ticketSettings.changeLogo') : t('ticketSettings.selectLogo')}
              variant="ghost"
              onPress={pickLogo}
            />
          </View>
        ) : null}

        <View style={{ height: 12 }} />
        <Button title={t('ticketSettings.updateButton')} onPress={save} loading={busy} />
      </ScrollView>
      <BottomNav active="index" />
    </View>
  );
}
