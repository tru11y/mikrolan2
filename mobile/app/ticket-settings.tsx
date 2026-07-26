import { useEffect, useState } from 'react';
import { ScrollView, Switch, Text, View } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import * as ImagePicker from 'expo-image-picker';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  api,
  extractErrorMessage,
  DEFAULT_TICKET_TEMPLATE,
  type TicketTemplate,
} from '@/src/lib/api';
import { Banner, Button, Field, Title, Subtitle, theme } from '@/src/components/ui';
import { BottomNav } from '@/src/components/BottomNav';

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
        thumbColor="#fff"
      />
    </View>
  );
}

function Divider() {
  return <View style={{ height: 1, backgroundColor: theme.border }} />;
}

export default function TicketSettingsScreen() {
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

  useEffect(() => {
    if (routerQuery.data?.ticketTemplate) setTpl(routerQuery.data.ticketTemplate);
  }, [routerQuery.data]);

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
      setMsg({ tone: 'success', text: 'Paramètres du ticket enregistrés.' });
    } catch (e) {
      setMsg({ tone: 'danger', text: extractErrorMessage(e) });
    } finally {
      setBusy(false);
    }
  }

  return (
    <View style={{ flex: 1, backgroundColor: theme.bg }}>
      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 100 }}>
        <Title>Paramètres du ticket</Title>
        <Subtitle>Personnalisez le reçu imprimé pour ce routeur</Subtitle>
        <View style={{ height: 12 }} />

        {msg ? <Banner tone={msg.tone}>{msg.text}</Banner> : null}

        <Toggle
          label="Afficher le nom de l'entreprise (PRO)"
          value={tpl.showCompanyName}
          onValueChange={(v) => set('showCompanyName', v)}
        />
        {tpl.showCompanyName ? (
          <View style={{ paddingBottom: 14 }}>
            <Field
              label="Nom de l'entreprise (PRO)"
              value={tpl.companyName ?? ''}
              onChangeText={(v) => set('companyName', v)}
              placeholder="MikroLan2"
            />
          </View>
        ) : null}
        <Divider />

        <Toggle
          label="Afficher le nom du Wi-Fi"
          value={tpl.showWifiName}
          onValueChange={(v) => set('showWifiName', v)}
        />
        <Divider />

        <Toggle
          label="Afficher le prix"
          value={tpl.showPrice}
          onValueChange={(v) => set('showPrice', v)}
        />
        {tpl.showPrice ? (
          <View style={{ paddingBottom: 14 }}>
            <Field
              label="Devise"
              value={tpl.currency}
              onChangeText={(v) => set('currency', v)}
              placeholder="FCFA"
            />
          </View>
        ) : null}
        <Divider />

        <Toggle
          label="Afficher le numéro du ticket (#)"
          value={tpl.showTicketNumber}
          onValueChange={(v) => set('showTicketNumber', v)}
        />
        <Divider />

        <Toggle
          label="Afficher le code QR"
          value={tpl.showQrCode}
          onValueChange={(v) => set('showQrCode', v)}
        />
        <Divider />

        <Toggle
          label="Afficher le nom du plan"
          value={tpl.showPlanName}
          onValueChange={(v) => set('showPlanName', v)}
        />
        <Divider />

        <Toggle
          label="Afficher la date et l'heure de création"
          value={tpl.showCreatedAt}
          onValueChange={(v) => set('showCreatedAt', v)}
        />
        <Divider />

        <Toggle
          label='Montrer "Propulsé par MikroLan2" (PRO)'
          value={tpl.showPoweredBy}
          onValueChange={(v) => set('showPoweredBy', v)}
        />
        <Divider />

        <Toggle
          label='Afficher "Note"'
          value={tpl.showNote}
          onValueChange={(v) => set('showNote', v)}
        />
        {tpl.showNote ? (
          <View style={{ paddingBottom: 14 }}>
            <Field
              label="Note"
              value={tpl.note ?? ''}
              onChangeText={(v) => set('note', v)}
              placeholder="Conservez le ticket pendant le service"
            />
          </View>
        ) : null}
        <Divider />

        <Toggle
          label="Afficher l'en-tête de page"
          value={tpl.showHeader}
          onValueChange={(v) => set('showHeader', v)}
        />
        {tpl.showHeader ? (
          <View style={{ paddingBottom: 14 }}>
            <Field
              label="En-tête de page"
              value={tpl.header ?? ''}
              onChangeText={(v) => set('header', v)}
            />
          </View>
        ) : null}
        <Divider />

        <Toggle
          label="Afficher le pied de page"
          value={tpl.showFooter}
          onValueChange={(v) => set('showFooter', v)}
        />
        {tpl.showFooter ? (
          <View style={{ paddingBottom: 14 }}>
            <Field
              label="Pied de page"
              value={tpl.footer ?? ''}
              onChangeText={(v) => set('footer', v)}
            />
          </View>
        ) : null}
        <Divider />

        <Toggle
          label="Afficher le numéro de page"
          value={tpl.showPageNumber}
          onValueChange={(v) => set('showPageNumber', v)}
        />
        <Divider />

        <Toggle
          label="Afficher le logo sur le ticket"
          value={tpl.showLogo}
          onValueChange={(v) => set('showLogo', v)}
        />
        {tpl.showLogo ? (
          <View style={{ paddingBottom: 14 }}>
            <Button
              title={tpl.logoDataUri ? 'Changer l’image' : 'Sélectionner une image'}
              variant="ghost"
              onPress={pickLogo}
            />
          </View>
        ) : null}

        <View style={{ height: 12 }} />
        <Button title="Mise à jour" onPress={save} loading={busy} />
      </ScrollView>
      <BottomNav />
    </View>
  );
}
