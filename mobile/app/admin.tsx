import { useState } from 'react';
import { ScrollView, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  api,
  type AdminInvoice,
  type AdminTenant,
  type AdminUser,
  type Tier,
} from '@/src/lib/api';
import { describeError } from '@/src/lib/errors';
import { formatXof } from '@/src/config/tiers';
import { useAuth } from '@/src/providers/auth-provider';
import {
  Badge,
  Button,
  Card,
  ConfirmDialog,
  Empty,
  ErrorState,
  FadeIn,
  Field,
  IconChip,
  Label,
  NumberField,
  Press,
  radius,
  Row,
  SectionTitle,
  Skeleton,
  SkeletonCard,
  space,
  Stat,
  Subtitle,
  Title,
  type,
  useToast,
  withAlpha,
} from '@/src/components/ui';
import { useTheme } from '@/src/providers/theme-provider';
import { AppHeader } from '@/src/components/AppHeader';
import { BottomNav, useBottomNavHeight } from '@/src/components/BottomNav';

type Tab = 'apercu' | 'demandes' | 'comptes' | 'formules' | 'tickets' | 'config';

function useTabs(): { key: Tab; label: string; icon: any }[] {
  const { t } = useTranslation();
  return [
    { key: 'apercu', label: t('admin.overview'), icon: 'speedometer-outline' },
    { key: 'demandes', label: t('admin.requests'), icon: 'mail-unread-outline' },
    { key: 'comptes', label: t('admin.accounts'), icon: 'people-outline' },
    { key: 'tickets', label: t('admin.sav'), icon: 'chatbubbles-outline' },
    { key: 'formules', label: t('admin.formulas'), icon: 'pricetags-outline' },
    { key: 'config', label: t('admin.config'), icon: 'settings-outline' },
  ];
}

function shortDate(iso: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('fr-FR', {
    day: '2-digit',
    month: 'short',
    year: '2-digit',
  });
}

// ─── Aperçu ──────────────────────────────────────────────────────────────────

function OverviewTab() {
  const theme = useTheme();
  const { t } = useTranslation();
  const query = useQuery({
    queryKey: ['admin', 'metrics'],
    queryFn: api.admin.metrics,
    refetchInterval: 60_000,
    placeholderData: keepPreviousData,
  });

  if (query.isLoading) {
    return (
      <View style={{ gap: space.md }}>
        <Row style={{ gap: space.md }}>
          <Skeleton height={92} radius={radius.lg} />
          <Skeleton height={92} radius={radius.lg} />
        </Row>
        <SkeletonCard />
      </View>
    );
  }
  if (query.isError || !query.data) {
    return (
      <ErrorState
        message={describeError(query.error).message}
        onRetry={() => query.refetch()}
        retrying={query.isFetching}
      />
    );
  }

  const m = query.data;

  return (
    <View style={{ gap: space.lg }}>
      <FadeIn>
        <Row style={{ gap: space.md, alignItems: 'stretch' }}>
          <Stat
            icon="cash-outline"
            tone="gold"
            value={formatXof(m.revenue.mrrXof)}
            label={t('admin.mrr')}
          />
          <Stat
            icon="mail-unread-outline"
            tone={m.pendingInvoices > 0 ? 'primary' : 'text'}
            value={String(m.pendingInvoices)}
            label={t('admin.pendingRequests')}
          />
        </Row>
      </FadeIn>

      <FadeIn delay={60}>
        <Row style={{ gap: space.md, alignItems: 'stretch' }}>
          <Stat
            icon="business-outline"
            value={String(m.tenants.total)}
            label={t('admin.clientAccounts')}
          />
          <Stat
            icon="ribbon-outline"
            tone="success"
            value={String(m.tenants.pro)}
            label={t('admin.proSubscribers')}
          />
        </Row>
      </FadeIn>

      <FadeIn delay={120}>
        <Row style={{ gap: space.md, alignItems: 'stretch' }}>
          <Stat
            icon="hourglass-outline"
            value={String(m.tenants.trialing)}
            label={t('admin.trialing')}
          />
          <Stat
            icon="lock-closed-outline"
            tone={m.tenants.locked > 0 ? 'danger' : 'text'}
            value={String(m.tenants.locked)}
            label={t('admin.locked')}
          />
        </Row>
      </FadeIn>

      <FadeIn delay={180}>
        <Card>
          <SectionTitle>{t('admin.operations')}</SectionTitle>
          <Row>
            <Text style={{ color: theme.textMuted, fontSize: type.body }}>
              {t('admin.routersOnline')}
            </Text>
            <Text style={{ color: theme.text, fontSize: type.body, fontWeight: '700' }}>
              {m.routers.online} / {m.routers.total}
            </Text>
          </Row>
          <Row>
            <Text style={{ color: theme.textMuted, fontSize: type.body }}>
              {t('admin.ticketsGenerated30d')}
            </Text>
            <Text style={{ color: theme.text, fontSize: type.body, fontWeight: '700' }}>
              {m.vouchers30d.generated.toLocaleString('fr-FR')}
            </Text>
          </Row>
          <Row>
            <Text style={{ color: theme.textMuted, fontSize: type.body }}>
              {t('admin.ticketsUsed30d')}
            </Text>
            <Text style={{ color: theme.text, fontSize: type.body, fontWeight: '700' }}>
              {m.vouchers30d.activated.toLocaleString('fr-FR')}
            </Text>
          </Row>
          <Row>
            <Text style={{ color: theme.textMuted, fontSize: type.body }}>
              {t('admin.trialsExpiring7d')}
            </Text>
            <Text
              style={{
                color: m.trialsExpiringIn7Days > 0 ? theme.gold : theme.text,
                fontSize: type.body,
                fontWeight: '700',
              }}
            >
              {m.trialsExpiringIn7Days}
            </Text>
          </Row>
        </Card>
      </FadeIn>

      {m.revenue.untieredActive > 0 ? (
        <FadeIn delay={240}>
          <Row
            style={{
              gap: space.md,
              alignItems: 'flex-start',
              borderWidth: 1,
              borderColor: withAlpha(theme.gold, 0.4),
              backgroundColor: withAlpha(theme.gold, 0.08),
              borderRadius: radius.md,
              padding: space.md,
            }}
          >
            <Ionicons name="alert-circle-outline" size={18} color={theme.gold} />
            <Text
              style={{ color: theme.text, fontSize: type.micro, flex: 1, lineHeight: 16 }}
            >
              {t('admin.untieredWarning', { count: m.revenue.untieredActive })}
            </Text>
          </Row>
        </FadeIn>
      ) : null}
    </View>
  );
}

// ─── Demandes d'activation ───────────────────────────────────────────────────

function RequestsTab() {
  const theme = useTheme();
  const { t } = useTranslation();
  const qc = useQueryClient();
  const toast = useToast();
  const [confirming, setConfirming] = useState<AdminInvoice | null>(null);

  const query = useQuery({
    queryKey: ['admin', 'invoices', 'PENDING'],
    queryFn: () => api.admin.invoices({ status: 'PENDING', limit: 50 }),
    refetchInterval: 30_000,
    placeholderData: keepPreviousData,
  });

  const activate = useMutation({
    mutationFn: (invoice: AdminInvoice) =>
      api.subscriptions.activate(invoice.tenantId, invoice.periodDays),
    onSuccess: async () => {
      toast.success(t('admin.subscriptionActivated'));
      setConfirming(null);
      await qc.invalidateQueries({ queryKey: ['admin'] });
    },
    onError: (e) => toast.error(describeError(e).message),
  });

  if (query.isLoading) return <SkeletonCard lines={3} />;
  if (query.isError) {
    return (
      <ErrorState
        message={describeError(query.error).message}
        onRetry={() => query.refetch()}
        retrying={query.isFetching}
      />
    );
  }

  const items = query.data?.items ?? [];
  if (!items.length) {
    return (
      <Empty
        icon="checkmark-done-outline"
        text={t('admin.noRequests')}
      />
    );
  }

  return (
    <View style={{ gap: space.md }}>
      {items.map((inv, i) => (
        <FadeIn key={inv.id} delay={i * 50}>
          <Card>
            <Row style={{ alignItems: 'flex-start' }}>
              <View style={{ flex: 1, paddingRight: space.md }}>
                <Text
                  style={{ color: theme.text, fontSize: type.bodyLg, fontWeight: '700' }}
                >
                  {inv.tenantName}
                </Text>
                <Text style={{ color: theme.textMuted, fontSize: type.micro }}>
                  {t('admin.requestedOn', { date: shortDate(inv.createdAt) })}
                </Text>
              </View>
              <View style={{ alignItems: 'flex-end' }}>
                <Text
                  style={{ color: theme.gold, fontSize: type.bodyLg, fontWeight: '800' }}
                >
                  {formatXof(inv.amount)}
                </Text>
                <Text style={{ color: theme.textMuted, fontSize: type.micro }}>
                  {inv.tierName ?? '—'} ·{' '}
                  {inv.billingPeriod === 'ANNUAL' ? t('admin.annualBilling') : t('admin.monthlyBilling')}
                </Text>
              </View>
            </Row>

            {/* Le résumé du conseiller : c'est ce qui dit pourquoi ce client
                demande cette formule, et ce qu'il faut lui répondre. */}
            {inv.note ? (
              <Row
                style={{
                  gap: space.sm,
                  alignItems: 'flex-start',
                  backgroundColor: theme.surfaceAlt,
                  borderRadius: radius.sm,
                  padding: space.md,
                }}
              >
                <Ionicons name="chatbubble-outline" size={14} color={theme.textMuted} />
                <Text
                  style={{ color: theme.textMuted, fontSize: type.micro, flex: 1, lineHeight: 16 }}
                >
                  {inv.note}
                </Text>
              </Row>
            ) : null}

            <Button
              title={t('admin.validatePayment', { days: inv.periodDays })}
              onPress={() => setConfirming(inv)}
              loading={activate.isPending && confirming?.id === inv.id}
            />
          </Card>
        </FadeIn>
      ))}

      <ConfirmDialog
        visible={confirming !== null}
        icon="cash-outline"
        tone="primary"
        title={t('admin.confirmCollection')}
        message={
          confirming
            ? t('admin.confirmCollectionMessage', { amount: formatXof(confirming.amount), tenant: confirming.tenantName, days: confirming.periodDays })
            : ''
        }
        confirmLabel={t('admin.activateButton')}
        busy={activate.isPending}
        onConfirm={() => confirming && activate.mutate(confirming)}
        onCancel={() => setConfirming(null)}
      />
    </View>
  );
}

// ─── Comptes & utilisateurs ──────────────────────────────────────────────────

function TenantRow({
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
}

function AccountsTab() {
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
      await qc.invalidateQueries({ queryKey: ['admin'] });
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
              borderWidth: 1,
              borderColor: scope === s ? theme.primary : theme.border,
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
            {tenants.data.items.map((t, i) => (
              <FadeIn key={t.id} delay={i * 40}>
                <TenantRow
                  tenant={t}
                  busy={toggle.isPending && pending?.item.id === t.id}
                  onToggle={() => setPending({ kind: 'tenant', item: t })}
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

// ─── Formules ────────────────────────────────────────────────────────────────

function TierEditor({ tier, onDone }: { tier: Tier; onDone: () => void }) {
  const theme = useTheme();
  const { t } = useTranslation();
  const toast = useToast();
  const qc = useQueryClient();
  const [name, setName] = useState(tier.name);
  const [price, setPrice] = useState(String(tier.monthlyXof));
  const [discount, setDiscount] = useState(String(tier.annualDiscount));
  const [routers, setRouters] = useState(
    tier.routerLimit === null ? '' : String(tier.routerLimit),
  );

  const save = useMutation({
    mutationFn: () =>
      api.admin.updateTier(tier.id, {
        name: name.trim(),
        monthlyXof: Number.parseInt(price, 10),
        annualDiscount: Number.parseInt(discount, 10),
        routerLimit: routers === '' ? null : Number.parseInt(routers, 10),
      }),
    onSuccess: async () => {
      toast.success(t('admin.formulaUpdated'));
      // La grille client et la vue admin lisent deux routes différentes.
      await qc.invalidateQueries({ queryKey: ['admin'] });
      await qc.invalidateQueries({ queryKey: ['tiers'] });
      onDone();
    },
    onError: (e) => toast.error(describeError(e).message),
  });

  const priceValid = /^\d+$/.test(price);
  const discountValid = /^\d+$/.test(discount) && Number.parseInt(discount, 10) <= 90;

  return (
    <View style={{ gap: space.md }}>
      <Field label={t('admin.commercialName')} value={name} onChangeText={setName} maxLength={60} />
      <Row style={{ gap: space.md, alignItems: 'flex-start' }}>
        <View style={{ flex: 1 }}>
          <NumberField
            label={t('admin.monthlyPriceFcfa')}
            value={price}
            onChangeValue={setPrice}
            min={0}
            max={10_000_000}
          />
        </View>
        <View style={{ flex: 1 }}>
          <NumberField
            label="Remise annuelle (%)"
            value={discount}
            onChangeValue={setDiscount}
            min={0}
            max={90}
          />
        </View>
      </Row>
      <NumberField
        label="Routeurs inclus"
        value={routers}
        onChangeValue={setRouters}
        min={1}
        max={10_000}
        optional
        placeholder="Illimité"
        hint="Laisser vide pour illimité."
      />
      {priceValid && discountValid ? (
        <Text style={{ color: theme.textMuted, fontSize: type.micro }}>
          Annuel :{' '}
          {formatXof(
            Math.round(
              Number.parseInt(price, 10) * (1 - Number.parseInt(discount, 10) / 100),
            ),
          )}{' '}
          / mois, soit{' '}
          {formatXof(
            Math.round(
              Number.parseInt(price, 10) * (1 - Number.parseInt(discount, 10) / 100),
            ) * 12,
          )}{' '}
          / an.
        </Text>
      ) : null}
      <Row style={{ gap: space.sm }}>
        <View style={{ flex: 1 }}>
          <Button title="Annuler" variant="ghost" onPress={onDone} />
        </View>
        <View style={{ flex: 1 }}>
          <Button
            title="Enregistrer"
            onPress={() => save.mutate()}
            loading={save.isPending}
            disabled={!name.trim() || !priceValid || !discountValid}
          />
        </View>
      </Row>
    </View>
  );
}

function TiersTab() {
  const theme = useTheme();
  const [editing, setEditing] = useState<string | null>(null);
  const query = useQuery({ queryKey: ['admin', 'tiers'], queryFn: api.admin.tiers });

  if (query.isLoading) return <SkeletonCard lines={3} />;
  if (query.isError) {
    return (
      <ErrorState
        message={describeError(query.error).message}
        onRetry={() => query.refetch()}
        retrying={query.isFetching}
      />
    );
  }

  const tiers = query.data ?? [];
  if (!tiers.length) {
    return <Empty icon="pricetags-outline" text="Aucune formule publiée." />;
  }

  return (
    <View style={{ gap: space.md }}>
      <Text style={{ color: theme.textMuted, fontSize: type.caption }}>
        Les prix modifiés ici s'appliquent aux nouvelles demandes. Les factures déjà
        émises gardent leur montant.
      </Text>

      {tiers.map((t, i) => (
        <FadeIn key={t.id} delay={i * 50}>
          <Card>
            <Row style={{ alignItems: 'flex-start' }}>
              <View style={{ flex: 1, paddingRight: space.md }}>
                <Row style={{ justifyContent: 'flex-start', gap: space.sm }}>
                  <Text
                    style={{ color: theme.text, fontSize: type.bodyLg, fontWeight: '700' }}
                  >
                    {t.name}
                  </Text>
                  {t.active ? null : <Badge label="Archivée" tone="muted" />}
                </Row>
                <Text style={{ color: theme.textMuted, fontSize: type.micro }}>
                  {t.routerLimit === null
                    ? 'Routeurs illimités'
                    : `${t.routerLimit} routeurs`}
                  {t.remoteAccess ? ' · accès distant' : ' · local seul'}
                </Text>
              </View>
              <View style={{ alignItems: 'flex-end' }}>
                <Text
                  style={{ color: theme.gold, fontSize: type.bodyLg, fontWeight: '800' }}
                >
                  {formatXof(t.monthlyXof)}
                </Text>
                <Text style={{ color: theme.textMuted, fontSize: type.micro }}>
                  annuel : {formatXof(t.annualMonthlyXof)} / mois
                </Text>
              </View>
            </Row>

            {editing === t.id ? (
              <FadeIn from={-6}>
                <TierEditor tier={t} onDone={() => setEditing(null)} />
              </FadeIn>
            ) : (
              <Button
                title="Modifier le tarif"
                variant="ghost"
                onPress={() => setEditing(t.id)}
              />
            )}
          </Card>
        </FadeIn>
      ))}
    </View>
  );
}

// ─── Écran ───────────────────────────────────────────────────────────────────

/**
 * Back-office de la plateforme, réservé au rôle SUPER_ADMIN.
 *
 * Le serveur ferme toutes les routes `/admin/*` aux autres rôles ; le garde
 * ci-dessous ne fait qu'éviter d'afficher un écran d'erreurs à quelqu'un qui
 * arriverait ici par un lien direct.
 */

function TicketsTab() {
  const theme = useTheme();
  const { t } = useTranslation();
  const toast = useToast();
  const ticketsQuery = useQuery({
    queryKey: ['admin-tickets'],
    queryFn: () => api.admin.listTickets(),
    placeholderData: keepPreviousData,
  });

  const statusMutation = useMutation({
    mutationFn: ({ id, status }: { id: string; status: 'OPEN' | 'IN_PROGRESS' | 'RESOLVED' | 'CLOSED' }) =>
      api.admin.setTicketStatus(id, status),
    onSuccess: () => {
      ticketsQuery.refetch();
      toast.success(t('admin.statusUpdated'));
    },
    onError: (e) => toast.error(describeError(e).message),
  });

  if (ticketsQuery.isLoading) return <SkeletonCard />;
  if (ticketsQuery.isError) return <ErrorState message={describeError(ticketsQuery.error).message} onRetry={() => ticketsQuery.refetch()} retrying={ticketsQuery.isFetching} />;

  const tickets = ticketsQuery.data?.items ?? [];

  if (!tickets.length) return <Empty icon="chatbubbles-outline" text="Aucun ticket SAV." />;

  return (
    <View style={{ gap: space.md }}>
      <SectionTitle>Tickets SAV</SectionTitle>
      {tickets.map((t: any) => (
        <Card key={t.id}>
          <Row style={{ justifyContent: 'space-between', marginBottom: 6 }}>
            <Text numberOfLines={1} style={{ color: theme.text, fontWeight: '700', fontSize: type.body, flex: 1, marginRight: space.sm }}>
              {t.subject}
            </Text>
            <Badge label={t.status} tone={t.status === 'OPEN' ? 'primary' : t.status === 'RESOLVED' ? 'success' : 'muted'} />
          </Row>
          <Text style={{ color: theme.textMuted, fontSize: type.caption }}>
            {t.tenantName} — {shortDate(t.createdAt)} — {t._count?.messages ?? 0} msg
          </Text>
          <Row style={{ gap: space.sm, marginTop: space.sm, flexWrap: 'wrap' }}>
            {['OPEN', 'IN_PROGRESS', 'RESOLVED', 'CLOSED'].filter((s) => s !== t.status).map((s) => (
              <Press
                key={s}
                onPress={() => statusMutation.mutate({ id: t.id, status: s as any })}
                style={{
                  paddingHorizontal: 10,
                  paddingVertical: 4,
                  borderRadius: radius.pill,
                  backgroundColor: theme.surfaceAlt,
                }}
              >
                <Text style={{ color: theme.textMuted, fontSize: 10, fontWeight: '600' }}>{s}</Text>
              </Press>
            ))}
          </Row>
        </Card>
      ))}
    </View>
  );
}

function ConfigTab() {
  const toast = useToast();
  const qc = useQueryClient();
  const configQuery = useQuery({
    queryKey: ['admin-config'],
    queryFn: () => api.admin.getConfig(),
  });

  const [waveNumber, setWaveNumber] = useState('');
  const [omNumber, setOmNumber] = useState('');
  const [instructions, setInstructions] = useState('');
  const [loaded, setLoaded] = useState(false);

  if (configQuery.data && !loaded) {
    setWaveNumber(configQuery.data['wave_number'] ?? '');
    setOmNumber(configQuery.data['om_number'] ?? '');
    setInstructions(configQuery.data['payment_instructions'] ?? '');
    setLoaded(true);
  }

  const saveMutation = useMutation({
    mutationFn: () =>
      api.admin.updateConfig({
        wave_number: waveNumber,
        om_number: omNumber,
        payment_instructions: instructions,
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin-config'] });
      toast.success('Configuration sauvegardée.');
    },
    onError: (e) => toast.error(describeError(e).message),
  });

  if (configQuery.isLoading) return <SkeletonCard />;
  if (configQuery.isError) return <ErrorState message={describeError(configQuery.error).message} onRetry={() => configQuery.refetch()} retrying={configQuery.isFetching} />;

  return (
    <View style={{ gap: space.lg }}>
      <SectionTitle>Numéros de paiement</SectionTitle>
      <Field label="Numéro Wave" value={waveNumber} onChangeText={setWaveNumber} placeholder="Ex: 77 123 45 67" />
      <Field label="Numéro Orange Money" value={omNumber} onChangeText={setOmNumber} placeholder="Ex: 78 987 65 43" />
      <Field label="Instructions de paiement" value={instructions} onChangeText={setInstructions} placeholder="Texte affiché au client lors du paiement" multiline />
      <Button title="Sauvegarder" variant="primary" onPress={() => saveMutation.mutate()} loading={saveMutation.isPending} />
    </View>
  );
}

export default function AdminScreen() {
  const theme = useTheme();
  const { t } = useTranslation();
  const navHeight = useBottomNavHeight();
  const router = useRouter();
  const { me } = useAuth();
  const TABS = useTabs();
  const [tab, setTab] = useState<Tab>('apercu');

  const pending = useQuery({
    queryKey: ['admin', 'invoices', 'PENDING'],
    queryFn: () => api.admin.invoices({ status: 'PENDING', limit: 50 }),
    enabled: me?.user.role === 'SUPER_ADMIN',
    refetchInterval: 30_000,
    placeholderData: keepPreviousData,
  });
  const pendingCount = pending.data?.items.length ?? 0;

  if (me && me.user.role !== 'SUPER_ADMIN') {
    return (
      <View style={{ flex: 1, backgroundColor: theme.bg }}>
        <AppHeader title="Administration" back />
        <ErrorState
          message="Cette section est réservée à l'administration de la plateforme."
          onRetry={() => router.back()}
        />
      </View>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: theme.bg }}>
      <AppHeader title="Administration" back />
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
                    borderWidth: 1,
                    borderColor: active ? theme.primary : theme.border,
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

        {tab === 'apercu' ? <OverviewTab /> : null}
        {tab === 'demandes' ? <RequestsTab /> : null}
        {tab === 'comptes' ? <AccountsTab /> : null}
        {tab === 'tickets' ? <TicketsTab /> : null}
        {tab === 'formules' ? <TiersTab /> : null}
        {tab === 'config' ? <ConfigTab /> : null}
      </ScrollView>
      <BottomNav active="account" />
    </View>
  );
}
