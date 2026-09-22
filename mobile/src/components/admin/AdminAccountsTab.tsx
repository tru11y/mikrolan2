import { memo, useState } from 'react';
import { Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, type AdminTenant, type AdminUser } from '@/src/lib/api';
import { describeError } from '@/src/lib/errors';
import {
  Badge,
  Button,
  Card,
  ConfirmDialog,
  Empty,
  ErrorState,
  FadeIn,
  Field,
  Press,
  radius,
  Row,
  SkeletonCard,
  space,
  type,
  useToast,
  withAlpha,
} from '@/src/components/ui';
import { useTheme } from '@/src/providers/theme-provider';
import { shortDate } from '@/src/lib/format';

const TenantRow = memo(function TenantRow({
  tenant,
  onToggle,
  busy,
}: {
  tenant: AdminTenant;
  onToggle: () => void;
  busy: boolean;
}) {
  const theme = useTheme();
  const { t } = useTranslation();
  const router = useRouter();
  const suspended = tenant.status === 'SUSPENDED';
  return (
    <Press onPress={() => router.push({ pathname: '/admin-tenant', params: { id: tenant.id } })}>
    <Card>
      <Row style={{ alignItems: 'flex-start' }}>
        <View style={{ flex: 1, paddingRight: space.md }}>
          <Row style={{ justifyContent: 'flex-start', gap: space.sm }}>
            <Text style={{ color: theme.text, fontSize: type.bodyLg, fontWeight: '700' }}>
              {tenant.name}
            </Text>
            {suspended ? <Badge label={t('admin.suspended')} tone="danger" /> : null}
          </Row>
          <Text style={{ color: theme.textMuted, fontSize: type.micro, marginTop: 2 }}>
            {tenant.userCount} utilisateur{tenant.userCount > 1 ? 's' : ''} ·{' '}
            {tenant.routerCount} routeur{tenant.routerCount > 1 ? 's' : ''} · inscrit le{' '}
            {shortDate(tenant.createdAt)}
          </Text>
        </View>
        <Badge
          label={tenant.tierName ?? tenant.plan}
          tone={tenant.plan === 'PRO' ? 'gold' : 'muted'}
        />
      </Row>

      {tenant.currentPeriodEnd ? (
        <Text style={{ color: theme.textMuted, fontSize: type.micro }}>
          Échéance : {shortDate(tenant.currentPeriodEnd)}
        </Text>
      ) : null}

      <Button
        title={suspended ? t('admin.reactivateAccount') : t('admin.suspendAccount')}
        variant={suspended ? 'ghost' : 'danger'}
        onPress={onToggle}
        loading={busy}
      />
    </Card>
    </Press>
  );
});

export function AdminAccountsTab() {
  const theme = useTheme();
  const { t } = useTranslation();
  const qc = useQueryClient();
  const toast = useToast();
  const [scope, setScope] = useState<'tenants' | 'users'>('tenants');
  const [search, setSearch] = useState('');
  const [pending, setPending] = useState<
    | { kind: 'tenant'; item: AdminTenant }
    | { kind: 'user'; item: AdminUser }
    | null
  >(null);

  // Le serveur refuse une recherche de moins de 3 caractères (anti-énumération
  // d'adresses) : on ne l'envoie donc qu'à partir de ce seuil.
  const q = search.trim().length >= 3 ? search.trim() : undefined;

  const tenants = useQuery({
    queryKey: ['admin', 'tenants', q ?? ''],
    queryFn: () => api.admin.tenants({ q, limit: 25 }),
    enabled: scope === 'tenants',
  });
  const users = useQuery({
    queryKey: ['admin', 'users', q ?? ''],
    queryFn: () => api.admin.users({ q, limit: 25 }),
    enabled: scope === 'users',
  });

  const toggle = useMutation({
    mutationFn: async () => {
      if (!pending) return;
      if (pending.kind === 'tenant') {
        const next = pending.item.status === 'SUSPENDED' ? 'ACTIVE' : 'SUSPENDED';
        await api.admin.setTenantStatus(pending.item.id, next);
      } else {
        const next = pending.item.status === 'SUSPENDED' ? 'ACTIVE' : 'SUSPENDED';
        await api.admin.setUserStatus(pending.item.id, next);
      }
    },
    onSuccess: async () => {
      toast.success(t('admin.statusUpdated'));
      setPending(null);
      await Promise.all([
        qc.invalidateQueries({ queryKey: ['admin', 'tenants'] }),
        qc.invalidateQueries({ queryKey: ['admin', 'users'] }),
        qc.invalidateQueries({ queryKey: ['admin', 'metrics'] }),
        qc.invalidateQueries({ queryKey: ['admin', 'fleet'] }),
      ]);
    },
    onError: (e) => toast.error(describeError(e).message),
  });

  const active = scope === 'tenants' ? tenants : users;

  return (
    <View style={{ gap: space.lg }}>
      <Row style={{ gap: space.sm, alignItems: 'stretch' }}>
        {(['tenants', 'users'] as const).map((s) => (
          <Press
            key={s}
            accessibilityRole="tab"
            accessibilityLabel={s === 'tenants' ? t('admin.tenants') : t('admin.users')}
            onPress={() => setScope(s)}
            style={{
              flex: 1,
              backgroundColor: scope === s ? withAlpha(theme.primary, 0.1) : theme.surfaceAlt,
              borderRadius: radius.md,
              paddingVertical: space.md - 2,
              alignItems: 'center',
            }}
          >
            <Text
              style={{
                color: scope === s ? theme.primary : theme.textMuted,
                fontSize: type.body,
                fontWeight: '700',
              }}
            >
              {s === 'tenants' ? t('admin.tenants') : t('admin.users')}
            </Text>
          </Press>
        ))}
      </Row>

      <Field
        label={t('common.search')}
        value={search}
        onChangeText={setSearch}
        placeholder={scope === 'tenants' ? t('admin.searchTenant') : t('admin.searchUser')}
        autoCapitalize="none"
        autoCorrect={false}
        hint={
          search.length > 0 && search.trim().length < 3
            ? t('admin.minChars')
            : undefined
        }
      />

      {active.isLoading ? (
        <View style={{ gap: space.md }}>
          <SkeletonCard />
          <SkeletonCard />
        </View>
      ) : active.isError ? (
        <ErrorState
          message={describeError(active.error).message}
          onRetry={() => active.refetch()}
          retrying={active.isFetching}
        />
      ) : scope === 'tenants' ? (
        !tenants.data?.items.length ? (
          <Empty icon="business-outline" text={t('admin.noTenantMatch')} />
        ) : (
          <View style={{ gap: space.md }}>
            {tenants.data.items.map((tn, i) => (
              <FadeIn key={tn.id} delay={i * 40}>
                <TenantRow
                  tenant={tn}
                  busy={toggle.isPending && pending?.item.id === tn.id}
                  onToggle={() => setPending({ kind: 'tenant', item: tn })}
                />
              </FadeIn>
            ))}
          </View>
        )
      ) : !users.data?.items.length ? (
        <Empty icon="person-outline" text={t('admin.noUserMatch')} />
      ) : (
        <View style={{ gap: space.md }}>
          {users.data.items.map((u, i) => (
            <FadeIn key={u.id} delay={i * 40}>
              <Card>
                <Row style={{ alignItems: 'flex-start' }}>
                  <View style={{ flex: 1, paddingRight: space.md }}>
                    <Text
                      style={{ color: theme.text, fontSize: type.body, fontWeight: '700' }}
                    >
                      {u.name || u.email}
                    </Text>
                    <Text style={{ color: theme.textMuted, fontSize: type.micro }}>
                      {u.email}
                    </Text>
                    <Text
                      style={{ color: theme.textMuted, fontSize: type.micro, marginTop: 2 }}
                    >
                      {u.tenantName} · {u.role} · {t('admin.lastLogin')}{' '}
                      {shortDate(u.lastLoginAt)}
                    </Text>
                  </View>
                  <Badge
                    label={u.status === 'ACTIVE' ? t('admin.active') : t('admin.suspended')}
                    tone={u.status === 'ACTIVE' ? 'success' : 'danger'}
                  />
                </Row>
                {/* Le serveur refuse de toucher à un SUPER_ADMIN : ne pas
                    proposer le bouton évite un 403 sans explication. */}
                {u.role === 'SUPER_ADMIN' ? null : (
                  <Button
                    title={
                      u.status === 'SUSPENDED'
                        ? t('admin.reactivateUser')
                        : t('admin.suspendUser')
                    }
                    variant={u.status === 'SUSPENDED' ? 'ghost' : 'danger'}
                    onPress={() => setPending({ kind: 'user', item: u })}
                    loading={toggle.isPending && pending?.item.id === u.id}
                  />
                )}
              </Card>
            </FadeIn>
          ))}
        </View>
      )}

      <ConfirmDialog
        visible={pending !== null}
        icon={pending?.item.status === 'SUSPENDED' ? 'lock-open-outline' : 'lock-closed-outline'}
        tone={pending?.item.status === 'SUSPENDED' ? 'primary' : 'danger'}
        title={
          pending?.item.status === 'SUSPENDED' ? t('admin.reactivateAccess') : t('admin.suspendAccess')
        }
        message={
          pending?.item.status === 'SUSPENDED'
            ? t('admin.accessRestored')
            : t('admin.sessionsRevoked')
        }
        confirmLabel={pending?.item.status === 'SUSPENDED' ? t('admin.reactivateAccess') : t('admin.suspendAccess')}
        busy={toggle.isPending}
        onConfirm={() => toggle.mutate()}
        onCancel={() => setPending(null)}
      />
    </View>
  );
}
