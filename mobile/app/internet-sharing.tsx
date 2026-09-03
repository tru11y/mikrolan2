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
  Press,
  space,
  Subtitle,
  Title,
  withAlpha,
} from '@/src/components/ui';
import { useTheme } from '@/src/providers/theme-provider';
import { BottomNav, useBottomNavHeight } from '@/src/components/BottomNav';
import { AppHeader } from '@/src/components/AppHeader';

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
  const theme = useTheme();
  return (
    <Press onPress={onPress}>
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
    </Press>
  );
}

export default function InternetSharingScreen() {
  const theme = useTheme();
  const { t } = useTranslation();
  const navHeight = useBottomNavHeight();
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
        text: t('internetSharing.ruleUpdated'),
      });
    } catch (e) {
      setMsg({ tone: 'danger', text: extractErrorMessage(e) });
    } finally {
      setBusy(false);
    }
  }

  return (
    <View style={{ flex: 1, backgroundColor: theme.bg }}>
      <AppHeader title={t('internetSharing.screenTitle')} back />
      <ScrollView
        contentContainerStyle={{ gap: space.lg, padding: space.lg, paddingBottom: navHeight }}
      >
        <View>
                    <Subtitle>
            {t('internetSharing.subtitle')}
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
            {t('internetSharing.schemaTitle')}
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
                  backgroundColor: withAlpha(theme.success, 0.13),
                  borderWidth: 1,
                  borderColor: withAlpha(theme.success, 0.33),
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                <Ionicons name="phone-portrait" size={26} color={theme.success} />
              </View>
              <Text style={{ color: theme.text, fontSize: 11, fontWeight: '700' }}>
                {t('internetSharing.smartphoneClient')}
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
                  backgroundColor: withAlpha(theme.danger, 0.09),
                  borderWidth: 1,
                  borderColor: withAlpha(theme.danger, 0.27),
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
                  {t('internetSharing.sharingBlocked')}
                </Text>
              </View>
            </View>

            <View style={{ alignItems: 'center', gap: 6, opacity: 0.7 }}>
              <View
                style={{
                  width: 56,
                  height: 56,
                  borderRadius: 16,
                  backgroundColor: withAlpha(theme.danger, 0.13),
                  borderWidth: 1,
                  borderColor: withAlpha(theme.danger, 0.33),
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                <Ionicons name="laptop" size={26} color={theme.danger} />
              </View>
              <Text style={{ color: theme.textMuted, fontSize: 11, fontWeight: '700' }}>
                {t('internetSharing.secondaryPc')}
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
              {t('internetSharing.ttlExplanation')}{' '}
              <Text style={{ color: theme.text, fontWeight: '700' }}>
                {t('internetSharing.ttlDecreasedBy1')}
              </Text>
              {t('internetSharing.ttlExplanation2')}
            </Text>
          </View>
        </Card>

        {msg ? <Banner tone={msg.tone}>{msg.text}</Banner> : null}

        {/* Options */}
        <View style={{ gap: 12 }}>
          <OptionCard
            active={selected === 'block'}
            activeColor={theme.primary}
            icon="ban"
            iconColor={theme.success}
            title={t('internetSharing.blockSharing')}
            subtitle={t('internetSharing.blockSharingSubtitle')}
            onPress={() => setSelected('block')}
          />
          <OptionCard
            active={selected === 'allow'}
            activeColor={theme.primary}
            icon="flash"
            iconColor={theme.textMuted}
            title={t('internetSharing.allowSharing')}
            subtitle={t('internetSharing.allowSharingSubtitle')}
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
          <Press
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
                {t('internetSharing.bridgeModeTitle')}
              </Text>
            </View>
            <Ionicons
              name={accordionOpen ? 'chevron-up' : 'chevron-down'}
              size={18}
              color={theme.textMuted}
            />
          </Press>
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
                  {t('internetSharing.bridgeModeNote')}{' '}
                </Text>
                {t('internetSharing.bridgeModeExplanation')}{' '}
                <Text style={{ color: theme.secondary, fontFamily: theme.mono }}>
                  {t('internetSharing.useIpFirewall')}
                </Text>{' '}
                {t('internetSharing.bridgeModeExplanation2')}
              </Text>
              <Text style={{ color: theme.warning, fontSize: 11 }}>
                {t('internetSharing.terminalCommand')}{' '}
                <Text style={{ fontFamily: theme.mono, color: theme.text }}>
                  /interface bridge settings set use-ip-firewall=yes
                </Text>
              </Text>
            </View>
          ) : null}
        </View>

        <Button
          title={t('internetSharing.applyAntiTethering')}
          onPress={apply}
          loading={busy}
        />
      </ScrollView>
      <BottomNav active="index" />
    </View>
  );
}
