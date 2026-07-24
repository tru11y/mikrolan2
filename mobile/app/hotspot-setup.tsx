import { useState } from 'react';
import { ScrollView, View } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { api, extractErrorMessage } from '@/src/lib/api';
import {
  Banner,
  Button,
  Card,
  Field,
  Label,
  Subtitle,
  theme,
  Title,
} from '@/src/components/ui';
import { BottomNav } from '@/src/components/BottomNav';

export default function HotspotSetupScreen() {
  const { routerId } = useLocalSearchParams<{ routerId: string }>();
  const [iface, setIface] = useState('');
  const [network, setNetwork] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  async function configure() {
    setError(null);
    setDone(null);
    if (!iface.trim()) {
      setError("L'interface est requise (ex. bridge, wlan1).");
      return;
    }
    setBusy(true);
    try {
      const res = await api.routers.configureHotspot(routerId, {
        interface: iface.trim(),
        network: network.trim() || undefined,
      });
      setDone(`Hotspot configuré — passerelle ${res.gateway} (${res.network}).`);
    } catch (e) {
      setError(extractErrorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <View style={{ flex: 1, backgroundColor: theme.bg }}>
      <ScrollView contentContainerStyle={{ gap: 16, padding: 16, paddingBottom: 100 }}>
        <Title>Configurer le hotspot</Title>
        <Banner tone="warning">
          Cette action modifie le réseau du routeur (adresse, DHCP, serveur
          hotspot). À n’utiliser que sur un routeur sans hotspot existant.
        </Banner>

        {error ? <Banner tone="danger">{error}</Banner> : null}
        {done ? <Banner tone="success">{done}</Banner> : null}

        <Card>
          <Field
            label="Interface"
            value={iface}
            onChangeText={setIface}
            placeholder="bridge"
            autoCapitalize="none"
          />
          <Field
            label="Réseau (CIDR, optionnel)"
            value={network}
            onChangeText={setNetwork}
            placeholder="10.5.50.0/24"
            autoCapitalize="none"
          />
          <Subtitle>
            Par défaut 10.5.50.0/24 — passerelle .1, plage DHCP .10–.254.
          </Subtitle>
          <Button title="Configurer" onPress={configure} loading={busy} />
        </Card>
      </ScrollView>
      <BottomNav active="routeurs" />
    </View>
  );
}
