import { View, Text, Pressable } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter, type Href } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/src/lib/api';
import { useActiveRouter } from '@/src/providers/active-router-provider';
import { icon, space, theme, type, type IoniconName } from './ui';

type Tab = { key: string; labelKey: string; icon: IoniconName; href: Href };

const TAB_ROW = space.sm - 2 + icon.md + 2 + type.micro + 6 + space.sm; // ≈ 50
const ROUTER_STRIP = space.sm - 2 + type.micro + 6 + space.sm - 2 + 1; // ≈ 27

/**
 * Height the bottom nav actually occupies, safe-area and router strip included.
 * Screens use it for their scroll padding — a hardcoded value left the last
 * item under the bar in router mode, or on phones with a gesture bar.
 */
export function useBottomNavHeight(): number {
  const insets = useSafeAreaInsets();
  const { activeRouterId } = useActiveRouter();
  return (
    TAB_ROW + insets.bottom + (activeRouterId ? ROUTER_STRIP : 0) + space.lg
  );
}

const GLOBAL_TABS: Tab[] = [
  { key: 'index', labelKey: 'bottomNav.home', icon: 'home-outline', href: '/(tabs)' },
  {
    key: 'routeurs',
    labelKey: 'bottomNav.routers',
    icon: 'hardware-chip-outline',
    href: '/(tabs)/routeurs',
  },
  {
    key: 'account',
    labelKey: 'bottomNav.settings',
    icon: 'person-outline',
    href: '/(tabs)/account',
  },
];

// Router-connected tab set — Maison becomes the router dashboard, and
// Plans/Tickets/Fichiers/Rapport are implicitly scoped to this router
// (matches the reference's 5-tab connected-router nav).
function routerTabs(routerId: string): Tab[] {
  return [
    {
      key: 'index',
      labelKey: 'bottomNav.home',
      icon: 'home-outline',
      href: `/router/${routerId}` as Href,
    },
    {
      key: 'plans',
      labelKey: 'bottomNav.plans',
      icon: 'layers-outline',
      href: { pathname: '/plans', params: { routerId } } as Href,
    },
    {
      key: 'tickets',
      labelKey: 'bottomNav.tickets',
      icon: 'ticket-outline',
      href: { pathname: '/generate-vouchers', params: { routerId } } as Href,
    },
    {
      key: 'fichiers',
      labelKey: 'bottomNav.files',
      icon: 'folder-outline',
      href: { pathname: '/fichiers', params: { routerId } } as Href,
    },
    {
      key: 'rapport',
      labelKey: 'bottomNav.report',
      icon: 'bar-chart-outline',
      href: { pathname: '/(tabs)/rapport', params: { routerId } } as Href,
    },
  ];
}

// Persistent bottom nav for stack screens (so the tab bar never disappears).
// Adapts app-wide based on whether a router is currently selected (see
// ActiveRouterProvider) — global mode vs router-connected mode, mirroring
// the MikroTicket reference's dual navigation.
export function BottomNav({ active }: { active?: string }) {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { activeRouterId, clearActiveRouter } = useActiveRouter();

  const activeRouterQuery = useQuery({
    queryKey: ['router', activeRouterId],
    queryFn: () => api.routers.get(activeRouterId as string),
    enabled: Boolean(activeRouterId),
  });

  const tabs = activeRouterId ? routerTabs(activeRouterId) : GLOBAL_TABS;

  async function exitRouterMode() {
    await clearActiveRouter();
    router.replace('/(tabs)/routeurs');
  }

  return (
    <View
      style={{
        position: 'absolute',
        left: 0,
        right: 0,
        bottom: 0,
        backgroundColor: theme.surface,
        borderTopWidth: 1,
        borderTopColor: theme.border,
      }}
    >
      {activeRouterId ? (
        <Pressable
          onPress={exitRouterMode}
          accessibilityLabel={t('bottomNav.exitRouterMode')}
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            justifyContent: 'center',
            gap: space.xs + 2,
            paddingVertical: space.sm - 2,
            borderBottomWidth: 1,
            borderBottomColor: theme.border,
            backgroundColor: theme.surfaceAlt,
          }}
        >
          <Ionicons name="hardware-chip" size={type.caption} color={theme.gold} />
          <Text style={{ color: theme.text, fontSize: type.micro, fontWeight: '700' }}>
            {activeRouterQuery.data?.alias ||
              activeRouterQuery.data?.identity ||
              t('bottomNav.router')}
          </Text>
          <Text style={{ color: theme.textMuted, fontSize: type.micro }}>·</Text>
          <Text
            style={{ color: theme.primary, fontSize: type.micro, fontWeight: '700' }}
          >
            {t('bottomNav.exit')}
          </Text>
        </Pressable>
      ) : null}
      <View
        style={{
          paddingBottom: space.sm + insets.bottom,
          paddingTop: space.sm - 2,
          flexDirection: 'row',
        }}
      >
        {tabs.map((tab) => {
          const on = tab.key === active;
          const label = t(tab.labelKey);
          return (
            <Pressable
              key={tab.key}
              accessibilityLabel={label}
              onPress={() => router.navigate(tab.href)}
              style={{ flex: 1, alignItems: 'center', gap: 2, paddingVertical: 0 }}
            >
              <Ionicons
                name={tab.icon}
                size={icon.md}
                color={on ? theme.primary : theme.textMuted}
              />
              <Text
                numberOfLines={1}
                style={{
                  fontSize: type.micro,
                  fontWeight: '600',
                  color: on ? theme.primary : theme.textMuted,
                }}
              >
                {label}
              </Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}
