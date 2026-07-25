import { useEffect, useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';
import { api, extractErrorMessage } from '@/src/lib/api';
import { Banner, Button, Card, Subtitle, theme, Title } from '@/src/components/ui';
import { BottomNav } from '@/src/components/BottomNav';

type Option = 'block' | 'allow';

function OptionCard({
  active,
  activeColor,
  icon,
  iconColor,
  title,
  subtitle,
  onPress,
}: {
  active: boolean;
  activeColor: string;
  icon: keyof typeof Ionicons.glyphMap;
  iconColor: string;
  title: string;
  subtitle: string;
  onPress: () => void;
}) {
  return (
    <Pressable onPress={onPress}>
      <View
        style={{
          padding: 16,
          borderRadius: 16,
          borderWidth: 2,
          borderColor: active ? activeColor : theme.border,
          backgroundColor: theme.surface,
          flexDirection: 'row',
          alignItems: 'center',
          gap: 12,
        }}
      >
        <View
          style={{
            width: 40,
            height: 40,
            borderRadius: 12,
            backgroundColor: iconColor + '22',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <Ionicons name={icon} size={20} color={iconColor} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={{ color: theme.text, fontWeight: '700', fontSize: 14 }}>
            {title}
          </Text>
          <Text style={{ color: theme.textMuted, fontSize: 12, marginTop: 2 }}>
            {subtitle}
          </Text>
        </View>
        <View
          style={{
            width: 24,
            height: 24,
            borderRadius: 12,
            borderWidth: 2,
            borderColor: active ? activeColor : theme.border,
            backgroundColor: active ? activeColor : 'transparent',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          {active ? (
            <Ionicons name="checkmark" size={15} color={theme.bg} />
          ) : null}
        </View>
      </View>
    </Pressable>
  );
}

export default function InternetSharingScreen() {
  const { routerId } = useLocalSearchParams<{ routerId: string }>();

  const query = useQuery({
    queryKey: ['internet-sharing', routerId],
    queryFn: () => api.routers.getInternetSharing(routerId),
    enabled: Boolean(routerId),
  });

  const [selected, setSelected] = useState<Option>('allow');
  const [accordionOpen, setAccordionOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<
    { tone: 'success' | 'danger'; text: string } | null
  >(null);

  useEffect(() => {
    if (query.data) setSelected(query.data.blocked ? 'block' : 'allow');
  }, [query.data]);

  async function apply() {
    setBusy(true);
    setMsg(null);
    try {
      await api.routers.setInternetSharing(routerId, selected === 'block');
      setMsg({
        tone: 'success',
        text: 'Configuration TTL mise à jour sur le routeur !',
      });
    } catch (e) {
      setMsg({ tone: 'danger', text: extractErrorMessage(e) });
    } finally {
      setBusy(false);
    }
  }

  return (
    <View style={{ flex: 1, backgroundColor: theme.bg }}>
      <ScrollView contentContainerStyle={{ gap: 16, padding: 16, paddingBottom: 100 }}>
        <View>
          <Title>Partage Internet (TTL)</Title>
          <Subtitle>
            Contrôlez la répartition de connexion (anti-tethering) sur MikroTik
          </Subtitle>
        </View>

        {/* Schéma */}
        <Card style={{ alignItems: 'center', gap: 16, paddingVertical: 24 }}>
          <Text
            style={{
              color: theme.warning,
              fontSize: 11,
              fontWeight: '700',
              letterSpacing: 1,
              textTransform: 'uppercase',
            }}
          >
            Schéma de blocage anti-tethering TTL = 1
          </Text>

          <View
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              gap: 16,
              width: '100%',
              justifyContent: 'center',
            }}
          >
            <View style={{ alignItems: 'center', gap: 6 }}>
              <View
                style={{
                  width: 56,
                  height: 56,
                  borderRadius: 16,
                  backgroundColor: theme.success + '22',
                  borderWidth: 1,
                  borderColor: theme.success + '55',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                <Ionicons name="phone-portrait" size={26} color={theme.success} />
              </View>
              <Text style={{ color: theme.text, fontSize: 11, fontWeight: '700' }}>
                Smartphone Client
              </Text>
            </View>

            <View style={{ flex: 1, alignItems: 'center', gap: 4 }}>
              <View
                style={{
                  width: '100%',
                  height: 3,
                  borderRadius: 2,
                  backgroundColor: theme.border,
                }}
              />
              <View
                style={{
                  backgroundColor: theme.danger + '18',
                  borderWidth: 1,
                  borderColor: theme.danger + '44',
                  borderRadius: 8,
                  paddingHorizontal: 8,
                  paddingVertical: 3,
                }}
              >
                <Text
                  style={{
                    color: theme.danger,
                    fontSize: 10,
                    fontWeight: '700',
                    textTransform: 'uppercase',
                  }}
                >
                  Partage bloqué (TTL=1)
                </Text>
              </View>
            </View>

            <View style={{ alignItems: 'center', gap: 6, opacity: 0.7 }}>
              <View
                style={{
                  width: 56,
                  height: 56,
                  borderRadius: 16,
                  backgroundColor: theme.danger + '22',
                  borderWidth: 1,
                  borderColor: theme.danger + '55',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                <Ionicons name="laptop" size={26} color={theme.danger} />
              </View>
              <Text style={{ color: theme.textMuted, fontSize: 11, fontWeight: '700' }}>
                PC Secondaire
              </Text>
            </View>
          </View>

          <View
            style={{
              backgroundColor: theme.surfaceAlt,
              borderRadius: 12,
              padding: 12,
            }}
          >
            <Text style={{ color: theme.textMuted, fontSize: 12, lineHeight: 18 }}>
              En fixant le paramètre{' '}
              <Text style={{ color: theme.text, fontWeight: '700' }}>TTL = 1</Text>{' '}
              dans le pare-feu RouterOS Mangle, tout paquet partagé via un point
              d'accès secondaire (USB ou partage WiFi) expire immédiatement,
              empêchant le vol de bande passante.
            </Text>
          </View>
        </Card>

        {msg ? <Banner tone={msg.tone}>{msg.text}</Banner> : null}

        {/* Options */}
        <View style={{ gap: 12 }}>
          <OptionCard
            active={selected === 'block'}
            activeColor={theme.success}
            icon="ban"
            iconColor={theme.success}
            title="Bloquer le partage internet"
            subtitle="Active les règles RouterOS IP Firewall Mangle (TTL Change = 1)"
            onPress={() => setSelected('block')}
          />
          <OptionCard
            active={selected === 'allow'}
            activeColor={theme.primary}
            icon="flash"
            iconColor={theme.warning}
            title="Autoriser le partage internet"
            subtitle="Conserver le TTL standard RouterOS sans restriction"
            onPress={() => setSelected('allow')}
          />
        </View>

        {/* Accordion Bridge Mode */}
        <View
          style={{
            backgroundColor: theme.surface,
            borderWidth: 1,
            borderColor: theme.border,
            borderRadius: 16,
            overflow: 'hidden',
          }}
        >
          <Pressable
            onPress={() => setAccordionOpen((v) => !v)}
            style={{
              padding: 16,
              flexDirection: 'row',
              alignItems: 'center',
              justifyContent: 'space-between',
            }}
          >
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
              <Ionicons name="warning-outline" size={18} color={theme.warning} />
              <Text style={{ color: theme.text, fontWeight: '700', fontSize: 13 }}>
                Configuration du mode Pont (Bridge Mode)
              </Text>
            </View>
            <Ionicons
              name={accordionOpen ? 'chevron-up' : 'chevron-down'}
              size={18}
              color={theme.textMuted}
            />
          </Pressable>
          {accordionOpen ? (
            <View
              style={{
                padding: 16,
                paddingTop: 0,
                gap: 8,
                borderTopWidth: 1,
                borderTopColor: theme.border,
              }}
            >
              <Text style={{ color: theme.textMuted, fontSize: 12, lineHeight: 18 }}>
                <Text style={{ color: theme.text, fontWeight: '700' }}>
                  Note importante :{' '}
                </Text>
                Si vos interfaces WiFi et Ethernet sont en mode Bridge (pont
                réseau), vous devez cocher l'option{' '}
                <Text style={{ color: theme.secondary, fontFamily: theme.mono }}>
                  Use IP Firewall
                </Text>{' '}
                dans le menu Bridge Settings de RouterOS pour que le blocage
                TTL fonctionne correctement.
              </Text>
              <Text style={{ color: theme.warning, fontSize: 11 }}>
                Commande Terminal:{' '}
                <Text style={{ fontFamily: theme.mono, color: theme.text }}>
                  /interface bridge settings set use-ip-firewall=yes
                </Text>
              </Text>
            </View>
          ) : null}
        </View>

        <Button
          title="Appliquer la règle Anti-Tethering"
          onPress={apply}
          loading={busy}
        />
      </ScrollView>
      <BottomNav />
    </View>
  );
}
