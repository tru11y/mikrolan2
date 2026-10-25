export { ScreenErrorBoundary as ErrorBoundary } from '@/src/components/ScreenErrorBoundary';
import { useEffect, useState } from 'react';
import { ScrollView, View } from 'react-native';
import { WebView } from 'react-native-webview';
import { useLocalSearchParams } from 'expo-router';
import { useTranslation } from 'react-i18next';
import * as ImagePicker from 'expo-image-picker';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api, extractErrorMessage } from '@/src/lib/api';
import {
  BLOCK_FLAG,
  compactPreset,
  moveBlock,
  receiptPreset,
  resolveTicketTemplate,
  type ResolvedTicketTemplate,
} from '@/src/lib/ticketTemplate';
import { BlockEditor, Divider, Segment, Stepper, Toggle } from '@/src/components/ticket-settings/TicketBlockEditor';
import { buildTicketsHtml } from '@/src/lib/ticketsPdf';
import { reportSilent } from '@/src/lib/report';
import {
  Banner,
  Button,
  Card,
  Field,
  Label,
  space,
  Subtitle,
  Title,
} from '@/src/components/ui';
import { useTheme } from '@/src/providers/theme-provider';
import { BottomNav, useBottomNavHeight } from '@/src/components/BottomNav';
import { AppHeader } from '@/src/components/AppHeader';

export default function TicketSettingsScreen() {
  const theme = useTheme();
  const { t } = useTranslation();
  const navHeight = useBottomNavHeight();
  const { routerId } = useLocalSearchParams<{ routerId: string }>();
  const qc = useQueryClient();

  const routerQuery = useQuery({
    queryKey: ['router', routerId],
    queryFn: () => api.routers.get(routerId),
    enabled: Boolean(routerId),
  });

  const [tpl, setTpl] = useState<ResolvedTicketTemplate>(resolveTicketTemplate(null));
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ tone: 'success' | 'danger'; text: string } | null>(
    null,
  );
  const [previewHtml, setPreviewHtml] = useState('');

  useEffect(() => {
    if (routerQuery.data?.ticketTemplate)
      setTpl(resolveTicketTemplate(routerQuery.data.ticketTemplate));
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
      preview: true,
    }).then((html) => {
      if (!cancelled) setPreviewHtml(html);
    });
    return () => {
      cancelled = true;
    };
  }, [tpl, routerQuery.data]);

  function set<K extends keyof ResolvedTicketTemplate>(key: K, value: ResolvedTicketTemplate[K]) {
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
      reportSilent('ticket-settings.save', e, { routerId });
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
          <View style={{ height: 340 }}>
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

        <Button
          title={t('ticketSettings.receiptPreset')}
          variant="ghost"
          onPress={() => setTpl(receiptPreset(tpl))}
        />
        <Button
          title={t('ticketSettings.compactPreset')}
          variant="ghost"
          onPress={() => setTpl(compactPreset(tpl))}
        />
        <Divider />

        <Label>{t('ticketSettings.layout')}</Label>
        <Stepper
          label={t('ticketSettings.columns')}
          value={tpl.columns}
          min={1}
          max={6}
          step={1}
          onChange={(v) => set('columns', v)}
        />
        <Stepper
          label={t('ticketSettings.cellHeight')}
          value={tpl.cellHeightMm}
          min={15}
          max={120}
          step={5}
          onChange={(v) => set('cellHeightMm', v)}
        />
        <Segment
          label={t('ticketSettings.durationFormat')}
          value={tpl.durationFormat}
          options={[
            ['hours', '24H'],
            ['auto', '1 j'],
          ]}
          onChange={(v) => set('durationFormat', v)}
        />
        <Segment
          label={t('ticketSettings.currencyPosition')}
          value={tpl.currencyPosition}
          options={[
            ['prefix', '$300'],
            ['suffix', '300 $'],
          ]}
          onChange={(v) => set('currencyPosition', v)}
        />
        <Segment
          label={t('ticketSettings.dateFormat')}
          value={tpl.dateFormat}
          options={[
            ['iso', '2026-10-20'],
            ['fr', '20/10/2026'],
          ]}
          onChange={(v) => set('dateFormat', v)}
        />
        <Field
          label={t('ticketSettings.currencyLabel')}
          value={tpl.currency}
          onChangeText={(v) => set('currency', v)}
          placeholder="FCFA"
        />
        <Toggle
          label={t('ticketSettings.boxedCode')}
          value={tpl.boxedCode}
          onValueChange={(v) => set('boxedCode', v)}
        />
        <Toggle
          label={t('ticketSettings.showCodeIcon')}
          value={tpl.showCodeIcon}
          onValueChange={(v) => set('showCodeIcon', v)}
        />
        <Toggle
          label={t('ticketSettings.priceDurationInline')}
          value={tpl.priceDurationInline}
          onValueChange={(v) => set('priceDurationInline', v)}
        />
        <Divider />

        <Label>{t('ticketSettings.lines')}</Label>
        {tpl.blocks.map((blk, i) => (
          <BlockEditor
            key={blk.id}
            block={blk}
            tpl={tpl}
            first={i === 0}
            last={i === tpl.blocks.length - 1}
            onToggle={(v) => {
              const flag = BLOCK_FLAG[blk.id];
              if (flag) set(flag, v);
            }}
            onChange={(next) =>
              set('blocks', tpl.blocks.map((x) => (x.id === blk.id ? next : x)))
            }
            onMove={(d) => set('blocks', moveBlock(tpl.blocks, i, d))}
            onText={(key, v) => set(key, v)}
            onPickLogo={pickLogo}
          />
        ))}

        <View style={{ height: 12 }} />
        <Button title={t('ticketSettings.updateButton')} onPress={save} loading={busy} />
      </ScrollView>
      <BottomNav active="index" />
    </View>
  );
}
