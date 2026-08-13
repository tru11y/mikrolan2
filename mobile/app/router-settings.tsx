import { useEffect, useState } from 'react';
import { Linking, ScrollView, Switch, Text, View } from 'react-native';
import * as Clipboard from 'expo-clipboard';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api, extractErrorMessage } from '@/src/lib/api';
import {
  deleteLocalCredentials,
  getLocalCredentials,
} from '@/src/lib/router-credentials';
import { withApi } from '@/src/services/mikrotik-lan/MikroTikApiClient';
import { getWifiInfo, sameSubnet24 } from '@/src/lib/lanBinder';
import { useActiveRouter } from '@/src/providers/active-router-provider';
import { useAuth } from '@/src/providers/auth-provider';
import {
  ActionSheet,
  type ActionSheetAction,
  Banner,
  Button,
  ConfirmDialog,
  Field,
  Label,
  Press,
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
// otherwise the pinned TCP socket hard-crashes the app (see router/[id].tsx),
// and WebFig/SSH/Winbox would silently target an unreachable LAN IP.
async function resolveAccessMode(routerId: string) {
  const creds = await getLocalCredentials(routerId);
  if (!creds) return { onLan: false, creds: null };
  const wifi = await getWifiInfo();
  const onLan =
    !!wifi &&
    (creds.host === wifi.gateway || sameSubnet24(creds.host, wifi.ipAddress));
  return { onLan, creds };
}

export default function RouterSettingsScreen() {
  const navHeight = useBottomNavHeight();
  const { routerId } = useLocalSearchParams<{ routerId: string }>();
  const router = useRouter();
  const qc = useQueryClient();
  const { clearActiveRouter } = useActiveRouter();
  const { isPro } = useAuth();
  const [rebootOpen, setRebootOpen] = useState(false);
  const [sheet, setSheet] = useState<{
    icon: IoniconName;
    title: string;
    message?: string;
    mono?: boolean;
    actions: ActionSheetAction[];
  } | null>(null);
  const closeSheet = () => setSheet(null);
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
  const [pushEnabled, setPushEnabled] = useState(true);
  const [aliasBusy, setAliasBusy] = useState(false);
  const [removeOpen, setRemoveOpen] = useState(false);
  const [removeBusy, setRemoveBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (routerQuery.data) {
      setAlias(routerQuery.data.alias ?? '');
      setPushEnabled(routerQuery.data.pushNotifications);
    }
  }, [routerQuery.data]);

  async function togglePush(value: boolean) {
    if (!routerId) return;
    setPushEnabled(value);
    try {
      await api.routers.update(routerId, { pushNotifications: value });
      await qc.invalidateQueries({ queryKey: ['router', routerId] });
    } catch {
      setPushEnabled(!value);
    }
  }

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
    const { onLan, creds } = await resolveAccessMode(routerId);
    if (creds && onLan) {
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
      id: 'lan_credentials',
      title: 'Identifiants du routeur',
      subtitle: 'Nécessaires pour les appareils autorisés et les sessions',
      icon: 'key-outline',
      color: theme.secondary,
      onPress: () => go('/router-credentials'),
    },
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
    ...(isPro
      ? [
          // WebFig / SSH / Winbox : ALWAYS go through the VPS DNAT URL, never
          // LAN. Matches mikroserver v1 behaviour: the dashboard button just
          // opens `http://<vps>:<port>/`, regardless of network. LAN detection
          // was tried but fails predictably on the router's own hotspot Wi-Fi
          // (captive portal), and it obscures the real infra when it kicks in.
          {
            id: 'webfig',
            title: 'WebFig',
            subtitle: "Interface web d'administration RouterOS",
            icon: 'globe-outline' as IoniconName,
            color: theme.primary,
            onPress: () => {
              const urls = remoteQuery.data?.accessUrls;
              if (urls?.webfig) {
                Linking.openURL(urls.webfig.url);
              } else {
                setSheet({
                  icon: 'globe-outline',
                  title: 'WebFig',
                  message: "Gestion à distance non activée pour ce routeur.",
                  actions: [{ label: 'Fermer', variant: 'cancel', onPress: closeSheet }],
                });
              }
            },
          },
          {
            id: 'ssh',
            title: 'Accès SSH',
            subtitle: 'Terminal en ligne de commande',
            icon: 'terminal-outline' as IoniconName,
            color: theme.secondary,
            onPress: () => {
              const urls = remoteQuery.data?.accessUrls;
              if (!urls?.ssh) {
                setSheet({
                  icon: 'terminal-outline',
                  title: 'SSH',
                  message: 'Gestion à distance non activée.',
                  actions: [{ label: 'Fermer', variant: 'cancel', onPress: closeSheet }],
                });
                return;
              }
              const { command, host, port } = urls.ssh;
              setSheet({
                icon: 'terminal-outline',
                title: 'Accès SSH',
                message: command,
                mono: true,
                actions: [
                  {
                    label: 'Copier',
                    onPress: () => {
                      void Clipboard.setStringAsync(command);
                      closeSheet();
                    },
                  },
                  {
                    label: 'Ouvrir',
                    tone: 'primary',
                    onPress: () => {
                      closeSheet();
                      Linking.openURL(`ssh://admin@${host}:${port}`).catch(() => {
                        setSheet({
                          icon: 'terminal-outline',
                          title: 'SSH',
                          message: 'Aucun client SSH détecté.',
                          actions: [{ label: 'Fermer', variant: 'cancel', onPress: closeSheet }],
                        });
                      });
                    },
                  },
                  { label: 'Fermer', variant: 'cancel', onPress: closeSheet },
                ],
              });
            },
          },
          {
            id: 'winbox',
            title: 'Winbox',
            subtitle: 'Application de gestion MikroTik',
            icon: 'cube-outline' as IoniconName,
            color: theme.gold,
            onPress: () => {
              const urls = remoteQuery.data?.accessUrls;
              if (!urls?.winbox) {
                setSheet({
                  icon: 'cube-outline',
                  title: 'Winbox',
                  message: 'Gestion à distance non activée.',
                  actions: [{ label: 'Fermer', variant: 'cancel', onPress: closeSheet }],
                });
                return;
              }
              const { address, host, port } = urls.winbox;
              setSheet({
                icon: 'cube-outline',
                title: 'Winbox',
                message: address,
                mono: true,
                actions: [
                  {
                    label: 'Copier',
                    onPress: () => {
                      void Clipboard.setStringAsync(address);
                      closeSheet();
                    },
                  },
                  {
                    label: 'Ouvrir MikroTik App',
                    tone: 'primary',
                    onPress: () => {
                      closeSheet();
                      Linking.openURL(`mikrotik://connect?address=${host}&port=${port}`).catch(
                        () => {
                          setSheet({
                            icon: 'cube-outline',
                            title: 'Winbox',
                            message: 'Application MikroTik non installée.',
                            actions: [{ label: 'Fermer', variant: 'cancel', onPress: closeSheet }],
                          });
                        },
                      );
                    },
                  },
                  { label: 'Fermer', variant: 'cancel', onPress: closeSheet },
                ],
              });
            },
          },
        ]
      : []),
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
            <Press
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
            </Press>
          ))}
        </View>

        {/* Notifications push pour ce routeur */}
        <View
          style={{
            backgroundColor: theme.surface,
            borderWidth: 1,
            borderColor: theme.border,
            borderRadius: 16,
            padding: 16,
            flexDirection: 'row',
            alignItems: 'center',
            justifyContent: 'space-between',
          }}
        >
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 14, flex: 1 }}>
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
              <Ionicons name="notifications-outline" size={20} color={theme.primary} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={{ color: theme.text, fontSize: 14, fontWeight: '700' }}>
                Notifications push
              </Text>
              <Text style={{ color: theme.textMuted, fontSize: 12, marginTop: 1 }}>
                Recevoir les alertes de ce routeur
              </Text>
            </View>
          </View>
          <Switch
            value={pushEnabled}
            onValueChange={togglePush}
            trackColor={{ false: theme.border, true: theme.primary }}
            thumbColor={theme.onStrong}
          />
        </View>

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

      <ActionSheet
        visible={sheet != null}
        icon={sheet?.icon ?? 'information-circle-outline'}
        title={sheet?.title ?? ''}
        message={sheet?.message}
        mono={sheet?.mono}
        actions={sheet?.actions ?? []}
        onClose={closeSheet}
      />

      <BottomNav active="index" />
    </View>
  );
}
