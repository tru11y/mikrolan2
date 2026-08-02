import { useEffect, useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api, extractErrorMessage } from '@/src/lib/api';
import {
  deleteLocalCredentials,
  getLocalCredentials,
} from '@/src/lib/router-credentials';
import { withApi } from '@/src/services/mikrotik-lan/MikroTikApiClient';
import { getWifiInfo } from '@/src/lib/lanBinder';
import { useActiveRouter } from '@/src/providers/active-router-provider';
import { useAuth } from '@/src/providers/auth-provider';
import {
  Banner,
  Button,
  ConfirmDialog,
  Field,
  Label,
  space,
  Subtitle,
  theme,
  Title,
  type IoniconName,
} from '@/src/components/ui';
import { BottomNav, useBottomNavHeight } from '@/src/components/BottomNav';
import { AppHeader } from '@/src/components/AppHeader';

type Item = {
  id: string;
  title: string;
  subtitle: string;
  icon: IoniconName;
  color: string;
  danger?: boolean;
  onPress: () => void;
};

// Only attempt LAN when the router's host is on the current Wi-Fi subnet —
// otherwise the pinned TCP socket hard-crashes the app (see router/[id].tsx).
function sameSubnet24(a: string, b: string): boolean {
  return a.split('.').slice(0, 3).join('.') === b.split('.').slice(0, 3).join('.');
}

export default function RouterSettingsScreen() {
  const navHeight = useBottomNavHeight();
  const { routerId } = useLocalSearchParams<{ routerId: string }>();
  const router = useRouter();
  const qc = useQueryClient();
  const { clearActiveRouter } = useActiveRouter();
  const { isPro } = useAuth();
  const [rebootOpen, setRebootOpen] = useState(false);
  const [rebootBusy, setRebootBusy] = useState(false);
  const [rebootResult, setRebootResult] = useState<
    { tone: 'success' | 'danger'; text: string } | null
  >(null);

  const routerQuery = useQuery({
    queryKey: ['router', routerId],
    queryFn: () => api.routers.get(routerId),
    enabled: Boolean(routerId),
  });

  const remoteQuery = useQuery({
    queryKey: ['router-remote', routerId],
    queryFn: () => api.routers.remoteStatus(routerId),
    enabled: Boolean(routerId) && isPro,
  });

  const [alias, setAlias] = useState('');
  // États séparés : un seul `busy` partagé faisait tourner le spinner des deux
  // boutons à la fois.
  const [aliasBusy, setAliasBusy] = useState(false);
  const [removeOpen, setRemoveOpen] = useState(false);
  const [removeBusy, setRemoveBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (routerQuery.data) setAlias(routerQuery.data.alias ?? '');
  }, [routerQuery.data]);

  async function saveAlias() {
    if (!routerId) return;
    setAliasBusy(true);
    setError(null);
    try {
      await api.routers.update(routerId, { alias: alias.trim() || null });
      await qc.invalidateQueries({ queryKey: ['router', routerId] });
      await qc.invalidateQueries({ queryKey: ['routers'] });
    } catch (e) {
      setError(extractErrorMessage(e));
    } finally {
      setAliasBusy(false);
    }
  }

  async function removeRouter() {
    if (!routerId) return;
    setRemoveBusy(true);
    setError(null);
    try {
      await api.routers.remove(routerId);
      await deleteLocalCredentials(routerId);
      await clearActiveRouter();
      await qc.invalidateQueries({ queryKey: ['routers'] });
      setRemoveOpen(false);
      router.dismissTo('/(tabs)/routeurs');
    } catch (e) {
      setError(extractErrorMessage(e));
      setRemoveBusy(false);
      setRemoveOpen(false);
    }
  }

  const go = (pathname: string) =>
    router.push({ pathname, params: { routerId } });
  async function rebootRouter() {
    if (!routerId) return;
    setRebootBusy(true);
    setRebootResult(null);

    // 1) LAN first: works offline on the router's Wi-Fi, only when on-subnet.
    const creds = await getLocalCredentials(routerId);
    const wifi = await getWifiInfo();
    const onRouterLan =
      !!creds &&
      !!wifi &&
      (creds.host === wifi.gateway || sameSubnet24(creds.host, wifi.ipAddress));
    if (creds && onRouterLan) {
      try {
        await withApi(creds, (c) => c.reboot());
        setRebootResult({
          tone: 'success',
          text: 'Redémarrage en cours (~45s).',
        });
        return;
      } catch (e) {
        setRebootResult({ tone: 'danger', text: extractErrorMessage(e) });
        return;
      } finally {
        setRebootBusy(false);
      }
    }

    // 2) Remote fallback (PRO tunnel).
    if (remoteQuery.data?.status === 'ACTIVE') {
      try {
        await api.routers.rebootRemote(routerId);
        setRebootResult({
          tone: 'success',
          text: 'Redémarrage en cours (~45s).',
        });
      } catch (e) {
        setRebootResult({ tone: 'danger', text: extractErrorMessage(e) });
      } finally {
        setRebootBusy(false);
      }
      return;
    }

    setRebootBusy(false);
    setRebootResult({
      tone: 'danger',
      text: 'Routeur injoignable (hors LAN et hors tunnel PRO).',
    });
  }

  const items: Item[] = [
    {
      id: 'anti_tethering',
      title: 'Bloquer le partage de connexion',
      subtitle: 'Empêcher un client de partager son accès',
      icon: 'share-social-outline',
      color: theme.warning,
      onPress: () => go('/internet-sharing'),
    },
    {
      id: 'dns_name',
      title: 'Page de connexion',
      subtitle: 'Adresse de la page vue par les clients',
      icon: 'globe-outline',
      color: theme.secondary,
      onPress: () => go('/hotspot-setup'),
    },
    {
      id: 'ip_bindings',
      title: 'Appareils autorisés',
      subtitle: 'Donner ou retirer l’accès à un appareil précis',
      icon: 'shield-outline',
      color: theme.primary,
      onPress: () => go('/ip-bindings'),
    },
    {
      id: 'users',
      title: 'Utilisateurs & sessions',
      subtitle: 'Sessions actives sur le routeur',
      icon: 'people-outline',
      color: theme.secondary,
      onPress: () => go('/sessions'),
    },
    {
      id: 'ticket_template',
      title: 'Paramètres du ticket',
      subtitle: 'Personnaliser le reçu imprimé (logo, notes, mentions)',
      icon: 'receipt-outline',
      color: theme.gold,
      onPress: () => go('/ticket-settings'),
    },
    {
      id: 'reboot',
      title: 'Redémarrer le routeur',
      subtitle: 'Coupe et relance le routeur',
      icon: 'refresh-outline',
      color: theme.danger,
      danger: true,
      onPress: () => setRebootOpen(true),
    },
  ];

  return (
    <View style={{ flex: 1, backgroundColor: theme.bg }}>
      <AppHeader title="Paramètres routeur" back />
      <ScrollView
        contentContainerStyle={{ padding: space.lg, gap: space.lg, paddingBottom: navHeight }}
      >
        {/* Settings list (single card, dividers) */}
        <View
          style={{
            backgroundColor: theme.surface,
            borderWidth: 1,
            borderColor: theme.border,
            borderRadius: 16,
            overflow: 'hidden',
          }}
        >
          {items.map((item, i) => (
            <Pressable
              key={item.id}
              onPress={item.onPress}
              style={{
                padding: 16,
                flexDirection: 'row',
                alignItems: 'center',
                justifyContent: 'space-between',
                borderTopWidth: i === 0 ? 0 : 1,
                borderTopColor: theme.border,
              }}
            >
              <View
                style={{
                  flexDirection: 'row',
                  alignItems: 'center',
                  gap: 14,
                  flex: 1,
                  paddingRight: 8,
                }}
              >
                <View
                  style={{
                    width: 40,
                    height: 40,
                    borderRadius: 12,
                    backgroundColor: theme.surfaceAlt,
                    borderWidth: 1,
                    borderColor: theme.border,
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  <Ionicons name={item.icon} size={20} color={item.color} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text
                    style={{
                      color: item.danger ? theme.danger : theme.text,
                      fontSize: 14,
                      fontWeight: '700',
                    }}
                  >
                    {item.title}
                  </Text>
                  <Text
                    style={{ color: theme.textMuted, fontSize: 12, marginTop: 1 }}
                  >
                    {item.subtitle}
                  </Text>
                </View>
              </View>
              <Ionicons name="chevron-forward" size={20} color={theme.textMuted} />
            </Pressable>
          ))}
        </View>

        {/* Gestion locale (hors réf) : renommer / supprimer ce routeur */}
        {error ? <Banner tone="danger">{error}</Banner> : null}
        <View
          style={{
            backgroundColor: theme.surface,
            borderWidth: 1,
            borderColor: theme.border,
            borderRadius: 16,
            padding: 16,
            gap: 12,
          }}
        >
          <Label>Alias</Label>
          <Field value={alias} onChangeText={setAlias} placeholder="Nom du routeur" />
          <Button title="Enregistrer" onPress={saveAlias} loading={aliasBusy} />
        </View>

        <Button
          title="Supprimer le routeur"
          variant="danger"
          onPress={() => setRemoveOpen(true)}
        />
      </ScrollView>

      <ConfirmDialog
        visible={rebootOpen}
        icon="refresh-outline"
        title="Redémarrer le routeur ?"
        message="Toutes les connexions en cours seront interrompues pendant environ 45 secondes."
        confirmLabel="Redémarrer"
        busy={rebootBusy}
        banner={rebootResult}
        onConfirm={rebootRouter}
        onCancel={() => {
          setRebootOpen(false);
          setRebootResult(null);
        }}
      />

      {/* La suppression était déclenchée par un simple appui : elle détruit le
          routeur et ses identifiants locaux, elle mérite une confirmation. */}
      <ConfirmDialog
        visible={removeOpen}
        icon="trash-outline"
        title="Supprimer ce routeur ?"
        message={`« ${routerQuery.data?.alias || routerQuery.data?.identity || 'Ce routeur'} » sera supprimé définitivement, comme s'il n'avait jamais été ajouté : accès à distance désactivé, tickets et fichiers générés effacés. Impossible à annuler.`}
        confirmLabel="Supprimer"
        busy={removeBusy}
        onConfirm={removeRouter}
        onCancel={() => setRemoveOpen(false)}
      />

      <BottomNav active="index" />
    </View>
  );
}
