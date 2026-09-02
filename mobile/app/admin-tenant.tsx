import { ScrollView, View, Text } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { Ionicons } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';
import { api, type AdminTenantDetail } from '@/src/lib/api';
import { describeError } from '@/src/lib/errors';
import { formatXof } from '@/src/config/tiers';
import {
  Badge,
  Card,
  ErrorState,
  FadeIn,
  radius,
  Row,
  SectionTitle,
  Skeleton,
  SkeletonCard,
  space,
  Subtitle,
  theme,
  Title,
  type,
} from '@/src/components/ui';
import { AppHeader } from '@/src/components/AppHeader';
import { BottomNav, useBottomNavHeight } from '@/src/components/BottomNav';

const HEALTH_COLORS: Record<string, string> = {
  ONLINE: theme.success,
  OFFLINE: theme.danger,
  ERROR: theme.danger,
  UNKNOWN: theme.textMuted,
};

export default function AdminTenantScreen() {
  const { t: tr } = useTranslation();
  const { id } = useLocalSearchParams<{ id: string }>();
  const navHeight = useBottomNavHeight();

  const tenantQuery = useQuery({
    queryKey: ['admin-tenant', id],
    queryFn: () => api.admin.tenant(id!),
    enabled: !!id,
  });

  const routersQuery = useQuery({
    queryKey: ['admin-tenant-routers', id],
    queryFn: () => api.admin.tenantRouters(id!),
    enabled: !!id,
  });

  const t = tenantQuery.data;
  const routers = routersQuery.data?.items ?? [];

  return (
    <View style={{ flex: 1, backgroundColor: theme.bg }}>
      <AppHeader title={t?.name ?? tr('adminTenant.client')} back />
      <ScrollView
        contentContainerStyle={{
          padding: space.lg,
          gap: space.xl,
          paddingBottom: navHeight,
        }}
      >
        {tenantQuery.isLoading ? (
          <View style={{ gap: space.md }}>
            <SkeletonCard />
            <SkeletonCard />
          </View>
        ) : tenantQuery.isError ? (
          <ErrorState
            message={describeError(tenantQuery.error).message}
            onRetry={() => tenantQuery.refetch()}
            retrying={tenantQuery.isFetching}
          />
        ) : t ? (
          <>
            <FadeIn>
              <Card>
                <Row style={{ justifyContent: 'space-between', marginBottom: space.md }}>
                  <Title>{t.name}</Title>
                  <Badge label={t.status} tone={t.status === 'ACTIVE' ? 'success' : 'danger'} />
                </Row>
                <Subtitle>{tr('adminTenant.createdOn', { date: new Date(t.createdAt).toLocaleDateString('fr-FR') })}</Subtitle>
                {t.subscription ? (
                  <View style={{ marginTop: space.md, gap: 4 }}>
                    <Row style={{ gap: space.sm }}>
                      <Text style={{ color: theme.textMuted, fontSize: type.caption }}>{tr('adminTenant.planLabel')}</Text>
                      <Badge label={t.subscription.tier?.name ?? t.subscription.plan} tone={t.subscription.plan === 'PRO' ? 'gold' : 'muted'} />
                    </Row>
                    {t.subscription.currentPeriodEnd ? (
                      <Text style={{ color: theme.textMuted, fontSize: type.caption }}>
                        {tr('adminTenant.expiresOn', { date: new Date(t.subscription.currentPeriodEnd).toLocaleDateString('fr-FR') })}
                      </Text>
                    ) : null}
                  </View>
                ) : null}
              </Card>
            </FadeIn>

            <FadeIn delay={60}>
              <SectionTitle>{tr('adminTenant.usersSection', { count: t.users.length })}</SectionTitle>
              <View style={{ gap: space.sm }}>
                {t.users.map((u) => (
                  <Card key={u.id}>
                    <Row style={{ justifyContent: 'space-between' }}>
                      <View style={{ flex: 1 }}>
                        <Text style={{ color: theme.text, fontWeight: '600', fontSize: type.body }}>
                          {u.name ?? u.email}
                        </Text>
                        <Text style={{ color: theme.textMuted, fontSize: type.caption }}>
                          {u.email} — {u.role}
                        </Text>
                      </View>
                      <Badge label={u.status} tone={u.status === 'ACTIVE' ? 'success' : 'danger'} />
                    </Row>
                  </Card>
                ))}
              </View>
            </FadeIn>

            <FadeIn delay={120}>
              <SectionTitle>{tr('adminTenant.routersSection', { count: routers.length })}</SectionTitle>
              {routersQuery.isLoading ? (
                <SkeletonCard />
              ) : routers.length === 0 ? (
                <Text style={{ color: theme.textMuted, fontSize: type.body }}>
                  {tr('adminTenant.noRouter')}
                </Text>
              ) : (
                <View style={{ gap: space.sm }}>
                  {routers.map((r: any) => (
                    <Card key={r.id}>
                      <Row style={{ justifyContent: 'space-between' }}>
                        <View style={{ flex: 1 }}>
                          <Text style={{ color: theme.text, fontWeight: '600', fontSize: type.body }}>
                            {r.alias ?? r.identity}
                          </Text>
                          <Text style={{ color: theme.textMuted, fontSize: type.caption }}>
                            {r.model ?? tr('adminTenant.unknownModel')} — {r.mode}
                          </Text>
                        </View>
                        <View
                          style={{
                            width: 10,
                            height: 10,
                            borderRadius: 5,
                            backgroundColor: HEALTH_COLORS[r.health] ?? theme.textMuted,
                          }}
                        />
                      </Row>
                    </Card>
                  ))}
                </View>
              )}
            </FadeIn>

            <FadeIn delay={180}>
              <SectionTitle>{tr('adminTenant.recentInvoices', { count: t.invoices.length })}</SectionTitle>
              {t.invoices.length === 0 ? (
                <Text style={{ color: theme.textMuted, fontSize: type.body }}>
                  {tr('adminTenant.noInvoice')}
                </Text>
              ) : (
                <View style={{ gap: space.sm }}>
                  {t.invoices.map((inv) => (
                    <Card key={inv.id}>
                      <Row style={{ justifyContent: 'space-between' }}>
                        <View>
                          <Text style={{ color: theme.text, fontWeight: '600', fontSize: type.body }}>
                            {formatXof(inv.amount)}
                          </Text>
                          <Text style={{ color: theme.textMuted, fontSize: type.caption }}>
                            {inv.tier?.name ?? inv.billingPeriod} — {new Date(inv.createdAt).toLocaleDateString('fr-FR')}
                          </Text>
                        </View>
                        <Badge
                          label={inv.status}
                          tone={
                            inv.status === 'PAID'
                              ? 'success'
                              : inv.status === 'PENDING'
                                ? 'gold'
                                : 'danger'
                          }
                        />
                      </Row>
                    </Card>
                  ))}
                </View>
              )}
            </FadeIn>
          </>
        ) : null}
      </ScrollView>
      <BottomNav />
    </View>
  );
}
