import { useEffect, useState } from 'react';
import { Alert, Pressable, ScrollView, Text, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api, extractErrorMessage } from '@/src/lib/api';
import { deleteLocalCredentials } from '@/src/lib/router-credentials';
import {
  Banner,
  Button,
  Field,
  Label,
  Subtitle,
  theme,
  Title,
  type IoniconName,
} from '@/src/components/ui';
import { BottomNav } from '@/src/components/BottomNav';

type Item = {
  id: string;
  title: string;
  subtitle: string;
  icon: IoniconName;
  color: string;
  danger?: boolean;
  onPress: () => void;
};

const SOON = 'Bientôt disponible';

export default function RouterSettingsScreen() {
  const { routerId } = useLocalSearchParams<{ routerId: string }>();
  const router = useRouter();
  const qc = useQueryClient();
  const [rebootOpen, setRebootOpen] = useState(false);

  const routerQuery = useQuery({
    queryKey: ['router', routerId],
    queryFn: () => api.routers.get(routerId),
    enabled: Boolean(routerId),
  });

  const [alias, setAlias] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (routerQuery.data) setAlias(routerQuery.data.alias ?? '');
  }, [routerQuery.data]);

  async function saveAlias() {
    if (!routerId) return;
    setBusy(true);
    setError(null);
    try {
      await api.routers.update(routerId, { alias: alias.trim() || null });
      await qc.invalidateQueries({ queryKey: ['router', routerId] });
      await qc.invalidateQueries({ queryKey: ['routers'] });
    } catch (e) {
      setError(extractErrorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  async function removeRouter() {
    if (!routerId) return;
    setBusy(true);
    setError(null);
    try {
      await api.routers.remove(routerId);
      await deleteLocalCredentials(routerId);
      await qc.invalidateQueries({ queryKey: ['routers'] });
      router.dismissTo('/(tabs)/routeurs');
    } catch (e) {
      setError(extractErrorMessage(e));
      setBusy(false);
    }
  }

  const go = (pathname: string) =>
    router.push({ pathname, params: { routerId } });
  const soon = (label: string) =>
    Alert.alert(label, `${SOON} sur cette version.`);

  const items: Item[] = [
    {
      id: 'anti_tethering',
      title: 'Partager WiFi (TTL Anti-Tethering)',
      subtitle: 'Bloquer la répartition Hotspot sur PC / téléphones',
      icon: 'share-social-outline',
      color: theme.warning,
      onPress: () => go('/hotspot-setup'),
    },
    {
      id: 'free_trial',
      title: 'Essai gratuit Hotspot',
      subtitle: 'Accès 15 min offert pour nouveaux utilisateurs',
      icon: 'gift-outline',
      color: theme.success,
      onPress: () => soon('Essai gratuit Hotspot'),
    },
    {
      id: 'dns_name',
      title: 'Nom DNS Portail captif',
      subtitle: 'Domaine du portail de connexion',
      icon: 'globe-outline',
      color: theme.secondary,
      onPress: () => go('/hotspot-setup'),
    },
    {
      id: 'ip_bindings',
      title: 'IP Bindings & Bypasses',
      subtitle: 'Autoriser ou bloquer des adresses MAC',
      icon: 'shield-outline',
      color: theme.primary,
      onPress: () => soon('IP Bindings & Bypasses'),
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
      id: 'change_password',
      title: 'Changer MDP administrateur',
      subtitle: 'Mettre à jour le mot de passe admin RouterOS',
      icon: 'key-outline',
      color: theme.danger,
      onPress: () => soon('Changer le mot de passe administrateur'),
    },
    {
      id: 'auto_disconnect',
      title: 'Coupure auto inactivité',
      subtitle: 'Déconnexion après 10 min sans trafic',
      icon: 'timer-outline',
      color: theme.warning,
      onPress: () => soon('Coupure auto inactivité'),
    },
    {
      id: 'reboot',
      title: 'Redémarrer le routeur',
      subtitle: 'Exécuter /system reboot via API RouterOS',
      icon: 'refresh-outline',
      color: theme.danger,
      danger: true,
      onPress: () => setRebootOpen(true),
    },
  ];

  return (
    <View style={{ flex: 1, backgroundColor: theme.bg }}>
      <ScrollView contentContainerStyle={{ padding: 16, gap: 16, paddingBottom: 100 }}>
        <View>
          <Title>Paramètres routeur</Title>
          <Subtitle>Réglages système & sécurité RouterOS</Subtitle>
        </View>

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
          <Button title="Enregistrer" onPress={saveAlias} loading={busy} />
        </View>

        <Button
          title="Supprimer le routeur"
          variant="danger"
          onPress={removeRouter}
          loading={busy}
        />
      </ScrollView>

      {/* Reboot confirmation modal */}
      {rebootOpen ? (
        <View
          style={{
            position: 'absolute',
            inset: 0,
            backgroundColor: '#000000cc',
            alignItems: 'center',
            justifyContent: 'center',
            padding: 16,
          }}
        >
          <View
            style={{
              width: '100%',
              maxWidth: 360,
              backgroundColor: theme.surface,
              borderWidth: 1,
              borderColor: theme.danger + '66',
              borderRadius: 16,
              padding: 20,
              gap: 16,
              alignItems: 'center',
            }}
          >
            <View
              style={{
                width: 48,
                height: 48,
                borderRadius: 16,
                backgroundColor: theme.danger + '22',
                borderWidth: 1,
                borderColor: theme.danger + '55',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <Ionicons name="refresh-outline" size={24} color={theme.danger} />
            </View>
            <View style={{ alignItems: 'center', gap: 4 }}>
              <Text style={{ color: theme.text, fontSize: 16, fontWeight: '700' }}>
                Redémarrer le routeur MikroTik ?
              </Text>
              <Text
                style={{
                  color: theme.textMuted,
                  fontSize: 12,
                  textAlign: 'center',
                }}
              >
                Toutes les sessions hotspot seront interrompues pendant ~45 secondes.
              </Text>
            </View>
            <View style={{ flexDirection: 'row', gap: 8, width: '100%' }}>
              <Pressable
                onPress={() => setRebootOpen(false)}
                style={{
                  flex: 1,
                  paddingVertical: 12,
                  borderRadius: 12,
                  backgroundColor: theme.surfaceAlt,
                  alignItems: 'center',
                }}
              >
                <Text style={{ color: theme.textMuted, fontWeight: '700', fontSize: 13 }}>
                  Annuler
                </Text>
              </Pressable>
              <Pressable
                onPress={() => {
                  setRebootOpen(false);
                  soon('Redémarrer le routeur');
                }}
                style={{
                  flex: 1,
                  paddingVertical: 12,
                  borderRadius: 12,
                  backgroundColor: theme.danger,
                  alignItems: 'center',
                }}
              >
                <Text style={{ color: '#fff', fontWeight: '700', fontSize: 13 }}>
                  Confirmer
                </Text>
              </Pressable>
            </View>
          </View>
        </View>
      ) : null}

      <BottomNav active="routeurs" />
    </View>
  );
}
