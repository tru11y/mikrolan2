export { ScreenErrorBoundary as ErrorBoundary } from '@/src/components/ScreenErrorBoundary';
import { useState } from 'react';
import { ScrollView, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { api } from '@/src/lib/api';
import { useAuth } from '@/src/providers/auth-provider';
import { useSseLive } from '@/src/providers/live-events-provider';
import {
  ErrorState,
  IconChip,
  Label,
  Press,
  radius,
  Row,
  space,
  Subtitle,
  Title,
  type,
  withAlpha,
} from '@/src/components/ui';
import { useTheme } from '@/src/providers/theme-provider';
import { AppHeader } from '@/src/components/AppHeader';
import { BottomNav, useBottomNavHeight } from '@/src/components/BottomNav';
import { type Tab, tabSetterRef } from '@/src/components/admin/shared';
import { AdminOverviewTab } from '@/src/components/admin/AdminOverviewTab';
import { AdminFleetTab } from '@/src/components/admin/AdminFleetTab';
import { AdminRequestsTab } from '@/src/components/admin/AdminRequestsTab';
import { AdminAccountsTab } from '@/src/components/admin/AdminAccountsTab';
import { AdminTicketsTab } from '@/src/components/admin/AdminTicketsTab';
import { AdminTiersTab } from '@/src/components/admin/AdminTiersTab';
import { AdminConfigTab } from '@/src/components/admin/AdminConfigTab';

function useTabs(): { key: Tab; label: string; icon: any }[] {
  const { t } = useTranslation();
  return [
    { key: 'apercu', label: 'Dashboard', icon: 'speedometer-outline' },
    { key: 'demandes', label: t('admin.requests'), icon: 'mail-unread-outline' },
    { key: 'fleet', label: 'Fleet', icon: 'hardware-chip-outline' },
    { key: 'comptes', label: t('admin.accounts'), icon: 'people-outline' },
    { key: 'tickets', label: t('admin.sav'), icon: 'chatbubbles-outline' },
    { key: 'formules', label: t('admin.formulas'), icon: 'pricetags-outline' },
    { key: 'config', label: t('admin.config'), icon: 'settings-outline' },
  ];
}

/**
 * Back-office de la plateforme, réservé au rôle SUPER_ADMIN.
 *
 * Le serveur ferme toutes les routes `/admin/*` aux autres rôles ; le garde
 * ci-dessous ne fait qu'éviter d'afficher un écran d'erreurs à quelqu'un qui
 * arriverait ici par un lien direct.
 */
export default function AdminScreen() {
  const theme = useTheme();
  const { t } = useTranslation();
  const navHeight = useBottomNavHeight();
  const router = useRouter();
  const { me } = useAuth();
  const sseLive = useSseLive();
  const TABS = useTabs();
  const [tab, setTab] = useState<Tab>('apercu');
  tabSetterRef.current = setTab;

  const pending = useQuery({
    queryKey: ['admin', 'invoices', 'PENDING'],
    queryFn: () => api.admin.invoices({ status: 'PENDING', limit: 50 }),
    enabled: me?.user.role === 'SUPER_ADMIN',
    refetchInterval: sseLive ? false : 30_000,
    placeholderData: keepPreviousData,
  });
  const pendingCount = pending.data?.items.length ?? 0;

  if (me && me.user.role !== 'SUPER_ADMIN') {
    return (
      <View style={{ flex: 1, backgroundColor: theme.bg }}>
        <AppHeader title={t('admin.title')} back />
        <ErrorState
          message={t('admin.accessRestricted')}
          onRetry={() => router.back()}
        />
      </View>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: theme.bg }}>
      <AppHeader title={t('admin.title')} back />
      <ScrollView
        contentContainerStyle={{
          padding: space.lg,
          gap: space.lg,
          paddingBottom: navHeight,
        }}
      >
        <Row style={{ gap: space.md }}>
          <IconChip name="shield-checkmark" color={theme.primary} size="lg" outlined />
          <View style={{ flex: 1 }}>
            <Title>Plateforme</Title>
            <Subtitle>Comptes, abonnements et tarification</Subtitle>
          </View>
        </Row>

        <View>
          <Label>Section</Label>
          <Row style={{ gap: space.sm, alignItems: 'stretch' }}>
            {TABS.map((tb) => {
              const active = tab === tb.key;
              const badge = tb.key === 'demandes' && pendingCount > 0 ? pendingCount : null;
              return (
                <Press
                  key={tb.key}
                  accessibilityRole="tab"
                  accessibilityLabel={tb.label}
                  onPress={() => setTab(tb.key)}
                  scaleTo={0.95}
                  style={{
                    flex: 1,
                    backgroundColor: active ? withAlpha(theme.primary, 0.1) : theme.surfaceAlt,
                    borderRadius: radius.md,
                    paddingVertical: space.sm + 2,
                    alignItems: 'center',
                    gap: 3,
                  }}
                >
                  <View>
                    <Ionicons
                      name={tb.icon}
                      size={18}
                      color={active ? theme.primary : theme.textMuted}
                    />
                    {badge ? (
                      <View
                        style={{
                          position: 'absolute',
                          top: -4,
                          right: -8,
                          minWidth: 15,
                          height: 15,
                          borderRadius: 8,
                          paddingHorizontal: 3,
                          backgroundColor: theme.danger,
                          alignItems: 'center',
                          justifyContent: 'center',
                        }}
                      >
                        <Text style={{ color: '#fff', fontSize: 9, fontWeight: '800' }}>
                          {badge > 9 ? '9+' : badge}
                        </Text>
                      </View>
                    ) : null}
                  </View>
                  <Text
                    style={{
                      color: active ? theme.primary : theme.textMuted,
                      fontSize: type.micro - 1,
                      fontWeight: '700',
                    }}
                  >
                    {tb.label}
                  </Text>
                </Press>
              );
            })}
          </Row>
        </View>

        {tab === 'apercu' ? <AdminOverviewTab /> : null}
        {tab === 'demandes' ? <AdminRequestsTab /> : null}
        {tab === 'fleet' ? <AdminFleetTab /> : null}
        {tab === 'comptes' ? <AdminAccountsTab /> : null}
        {tab === 'tickets' ? <AdminTicketsTab /> : null}
        {tab === 'formules' ? <AdminTiersTab /> : null}
        {tab === 'config' ? <AdminConfigTab /> : null}
      </ScrollView>
      <BottomNav active="account" />
    </View>
  );
}
