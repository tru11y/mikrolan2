export { ScreenErrorBoundary as ErrorBoundary } from '@/src/components/ScreenErrorBoundary';
import { useState } from 'react';
import { Alert, Modal, ScrollView, TextInput, TouchableOpacity, View, Text } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { Ionicons } from '@expo/vector-icons';
import { useQuery, useQueryClient, useMutation } from '@tanstack/react-query';
import { api, extractErrorMessage, type AdminTenantDetail } from '@/src/lib/api';
import { describeError } from '@/src/lib/errors';
import { formatXof } from '@/src/config/tiers';
import {
  Badge,
  Banner,
  Button,
  Card,
  ErrorState,
  FadeIn,
  OutlinedField,
  Press,
  radius,
  Row,
  SectionTitle,
  Skeleton,
  SkeletonCard,
  space,
  Subtitle,
  Title,
  type,
  weight,
  withAlpha,
} from '@/src/components/ui';
import { useTheme, type ThemeColors } from '@/src/providers/theme-provider';
import { AppHeader } from '@/src/components/AppHeader';
import { BottomNav, useBottomNavHeight } from '@/src/components/BottomNav';

function healthColor(t: ThemeColors, status: string): string {
  switch (status) {
    case 'ONLINE': return t.success;
    case 'OFFLINE': case 'ERROR': return t.danger;
    default: return t.textMuted;
  }
}

export default function AdminTenantScreen() {
  const theme = useTheme();
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

  const tiersQuery = useQuery({
    queryKey: ['admin-tiers'],
    queryFn: () => api.admin.tiers(),
  });

  const queryClient = useQueryClient();
  const [diagRouterId, setDiagRouterId] = useState<string | null>(null);
  const diagQuery = useQuery({
    queryKey: ['admin-router-diag', id, diagRouterId],
    queryFn: () => api.admin.routerDiagnostics(id!, diagRouterId!),
    enabled: !!id && !!diagRouterId,
  });

  const rebootMutation = useMutation({
    mutationFn: (routerId: string) => api.admin.rebootRouter(id!, routerId),
    onSuccess: () => setDiagRouterId(null),
  });

  const [showEditSub, setShowEditSub] = useState(false);
  const [editPlan, setEditPlan] = useState<'FREE' | 'PRO'>('FREE');
  const [editTierId, setEditTierId] = useState<string | null>(null);
  const [editPeriodEnd, setEditPeriodEnd] = useState('');
  const [editRouterOverride, setEditRouterOverride] = useState('');
  const [editUserOverride, setEditUserOverride] = useState('');
  const [editError, setEditError] = useState<string | null>(null);

  function openEditSub() {
    const sub = tenantQuery.data?.subscription;
    setEditPlan(sub?.plan ?? 'FREE');
    setEditTierId(sub?.tier?.key ? (tiersQuery.data?.find((ti) => ti.key === sub.tier!.key)?.id ?? null) : null);
    setEditPeriodEnd(sub?.currentPeriodEnd ? sub.currentPeriodEnd.slice(0, 10) : '');
    setEditRouterOverride('');
    setEditUserOverride('');
    setEditError(null);
    setShowEditSub(true);
  }

  const patchMutation = useMutation({
    mutationFn: (patch: Parameters<typeof api.admin.patchSubscription>[1]) =>
      api.admin.patchSubscription(id!, patch),
    onSuccess: () => {
      setShowEditSub(false);
      queryClient.invalidateQueries({ queryKey: ['admin-tenant', id] });
    },
    onError: (e: any) => setEditError(e?.response?.data?.message ?? e?.message ?? 'Erreur'),
  });

  function submitEditSub() {
    const patch: Record<string, unknown> = { plan: editPlan };
    if (editTierId) patch.tierId = editTierId;
    if (editPeriodEnd) patch.currentPeriodEnd = new Date(editPeriodEnd).toISOString();
    if (editRouterOverride) patch.routerLimitOverride = parseInt(editRouterOverride, 10) || null;
    if (editUserOverride) patch.userLimitOverride = parseInt(editUserOverride, 10) || null;
    patchMutation.mutate(patch as any);
  }

  const t = tenantQuery.data;
  const routers = routersQuery.data?.items ?? [];
  const tiers = tiersQuery.data ?? [];

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
                <View style={{ marginTop: space.md }}>
                  <Button
                    title={tr('adminTenant.editSubscription')}
                    variant="ghost"
                    onPress={openEditSub}
                  />
                </View>
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
                    <Press key={r.id} onPress={() => setDiagRouterId(r.id)}>
                      <Card>
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
                              backgroundColor: healthColor(theme, r.health),
                            }}
                          />
                        </Row>
                      </Card>
                    </Press>
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
                        <View style={{ flex: 1 }}>
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
                      {inv.status === 'PENDING' ? (
                        <Row style={{ gap: space.sm, marginTop: space.sm }}>
                          <View style={{ flex: 1 }}>
                            <Button
                              title={tr('adminTenant.validateInvoice')}
                              onPress={() => {
                                api.admin.validateInvoice(inv.id).then(() =>
                                  queryClient.invalidateQueries({ queryKey: ['admin-tenant', id] }),
                                ).catch((e) => Alert.alert('Erreur', extractErrorMessage(e)));
                              }}
                            />
                          </View>
                          <View style={{ flex: 1 }}>
                            <Button
                              title={tr('adminTenant.rejectInvoice')}
                              variant="danger"
                              onPress={() => {
                                api.admin.rejectInvoice(inv.id, 'Refusé').then(() =>
                                  queryClient.invalidateQueries({ queryKey: ['admin-tenant', id] }),
                                ).catch((e) => Alert.alert('Erreur', extractErrorMessage(e)));
                              }}
                            />
                          </View>
                        </Row>
                      ) : null}
                    </Card>
                  ))}
                </View>
              )}
            </FadeIn>
          </>
        ) : null}
      </ScrollView>
      <BottomNav />

      <Modal visible={!!diagRouterId} animationType="slide" transparent>
        <View style={{ flex: 1, backgroundColor: withAlpha(theme.bg, 0.95), justifyContent: 'center', padding: space.xxl }}>
          <Card style={{ gap: space.md }}>
            <Row style={{ justifyContent: 'space-between' }}>
              <Title>{tr('adminTenant.diagnostics')}</Title>
              <Press onPress={() => setDiagRouterId(null)}>
                <Ionicons name="close" size={24} color={theme.text} />
              </Press>
            </Row>
            {diagQuery.isLoading ? (
              <Skeleton style={{ height: 120, borderRadius: radius.md }} />
            ) : diagQuery.isError ? (
              <Text style={{ color: theme.danger, fontSize: type.body }}>
                {(diagQuery.error as any)?.response?.data?.message ?? (diagQuery.error as Error)?.message ?? 'Erreur'}
              </Text>
            ) : diagQuery.data ? (
              <View style={{ gap: 4 }}>
                {Object.entries(diagQuery.data).map(([k, v]) => (
                  <Row key={k} style={{ justifyContent: 'space-between' }}>
                    <Text style={{ color: theme.textMuted, fontSize: type.caption }}>{k}</Text>
                    <Text style={{ color: theme.text, fontSize: type.caption, fontWeight: '600' }}>{v}</Text>
                  </Row>
                ))}
              </View>
            ) : null}
            <Button
              title={tr('adminTenant.reboot')}
              variant="danger"
              onPress={() => { if (diagRouterId) rebootMutation.mutate(diagRouterId); }}
              loading={rebootMutation.isPending}
            />
          </Card>
        </View>
      </Modal>

      <Modal visible={showEditSub} animationType="slide" transparent>
        <View style={{ flex: 1, backgroundColor: withAlpha(theme.bg, 0.95), justifyContent: 'center', padding: space.xxl }}>
          <Card style={{ gap: space.lg }}>
            <Row style={{ justifyContent: 'space-between', marginBottom: space.sm }}>
              <Title>{tr('adminTenant.editSubscription')}</Title>
              <Press onPress={() => setShowEditSub(false)}>
                <Ionicons name="close" size={24} color={theme.text} />
              </Press>
            </Row>

            {editError ? <Banner tone="danger">{editError}</Banner> : null}

            <View style={{ gap: space.xs }}>
              <Text style={{ color: theme.textMuted, fontSize: type.caption }}>{tr('adminTenant.planLabel')}</Text>
              <Row style={{ gap: space.sm }}>
                {(['FREE', 'PRO'] as const).map((p) => (
                  <TouchableOpacity
                    key={p}
                    onPress={() => setEditPlan(p)}
                    style={{
                      flex: 1,
                      paddingVertical: space.sm,
                      borderRadius: radius.md,
                      backgroundColor: editPlan === p ? theme.primary : theme.surface,
                      alignItems: 'center',
                    }}
                  >
                    <Text style={{ color: editPlan === p ? '#fff' : theme.text, fontWeight: '600' }}>{p}</Text>
                  </TouchableOpacity>
                ))}
              </Row>
            </View>

            {tiers.length > 0 ? (
              <View style={{ gap: space.xs }}>
                <Text style={{ color: theme.textMuted, fontSize: type.caption }}>{tr('adminTenant.tier')}</Text>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ flexDirection: 'row' }}>
                  <Row style={{ gap: space.sm }}>
                    {tiers.filter((ti) => ti.active).map((ti) => (
                      <TouchableOpacity
                        key={ti.id}
                        onPress={() => setEditTierId(editTierId === ti.id ? null : ti.id)}
                        style={{
                          paddingHorizontal: space.md,
                          paddingVertical: space.sm,
                          borderRadius: radius.md,
                          backgroundColor: editTierId === ti.id ? theme.primary : theme.surface,
                        }}
                      >
                        <Text style={{ color: editTierId === ti.id ? '#fff' : theme.text, fontSize: type.caption }}>
                          {ti.name}
                        </Text>
                      </TouchableOpacity>
                    ))}
                  </Row>
                </ScrollView>
              </View>
            ) : null}

            <OutlinedField
              label={tr('adminTenant.periodEnd')}
              value={editPeriodEnd}
              onChangeText={setEditPeriodEnd}
              placeholder="YYYY-MM-DD"
              keyboardType="numbers-and-punctuation"
            />

            <OutlinedField
              label={tr('adminTenant.routerOverride')}
              value={editRouterOverride}
              onChangeText={setEditRouterOverride}
              placeholder={tr('adminTenant.overridePlaceholder')}
              keyboardType="number-pad"
            />

            <OutlinedField
              label={tr('adminTenant.userOverride')}
              value={editUserOverride}
              onChangeText={setEditUserOverride}
              placeholder={tr('adminTenant.overridePlaceholder')}
              keyboardType="number-pad"
            />

            <Button
              title={tr('common.save')}
              onPress={submitEditSub}
              loading={patchMutation.isPending}
            />
          </Card>
        </View>
      </Modal>
    </View>
  );
}
