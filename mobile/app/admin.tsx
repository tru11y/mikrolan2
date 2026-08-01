import { useState } from 'react';
import { ScrollView, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
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
  theme,
  Title,
  type,
  useToast,
} from '@/src/components/ui';
import { AppHeader } from '@/src/components/AppHeader';
import { BottomNav, useBottomNavHeight } from '@/src/components/BottomNav';

type Tab = 'apercu' | 'demandes' | 'comptes' | 'formules';

const TABS: { key: Tab; label: string; icon: 'speedometer-outline' | 'mail-unread-outline' | 'people-outline' | 'pricetags-outline' }[] = [
  { key: 'apercu', label: 'Aperçu', icon: 'speedometer-outline' },
  { key: 'demandes', label: 'Demandes', icon: 'mail-unread-outline' },
  { key: 'comptes', label: 'Comptes', icon: 'people-outline' },
  { key: 'formules', label: 'Formules', icon: 'pricetags-outline' },
];

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
  const query = useQuery({
    queryKey: ['admin', 'metrics'],
    queryFn: api.admin.metrics,
    refetchInterval: 60_000,
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
            label="Revenu mensuel récurrent"
          />
          <Stat
            icon="mail-unread-outline"
            tone={m.pendingInvoices > 0 ? 'primary' : 'text'}
            value={String(m.pendingInvoices)}
            label="Demandes en attente"
          />
        </Row>
      </FadeIn>

      <FadeIn delay={60}>
        <Row style={{ gap: space.md, alignItems: 'stretch' }}>
          <Stat
            icon="business-outline"
            value={String(m.tenants.total)}
            label="Comptes clients"
          />
          <Stat
            icon="ribbon-outline"
            tone="success"
            value={String(m.tenants.pro)}
            label="Abonnés PRO"
          />
        </Row>
      </FadeIn>

      <FadeIn delay={120}>
        <Row style={{ gap: space.md, alignItems: 'stretch' }}>
          <Stat
            icon="hourglass-outline"
            value={String(m.tenants.trialing)}
            label="En période d’essai"
          />
          <Stat
            icon="lock-closed-outline"
            tone={m.tenants.locked > 0 ? 'danger' : 'text'}
            value={String(m.tenants.locked)}
            label="Verrouillés"
          />
        </Row>
      </FadeIn>

      <FadeIn delay={180}>
        <Card>
          <SectionTitle>Exploitation</SectionTitle>
          <Row>
            <Text style={{ color: theme.textMuted, fontSize: type.body }}>
              Routeurs en ligne
            </Text>
            <Text style={{ color: theme.text, fontSize: type.body, fontWeight: '700' }}>
              {m.routers.online} / {m.routers.total}
            </Text>
          </Row>
          <Row>
            <Text style={{ color: theme.textMuted, fontSize: type.body }}>
              Tickets générés (30 j)
            </Text>
            <Text style={{ color: theme.text, fontSize: type.body, fontWeight: '700' }}>
              {m.vouchers30d.generated.toLocaleString('fr-FR')}
            </Text>
          </Row>
          <Row>
            <Text style={{ color: theme.textMuted, fontSize: type.body }}>
              Tickets utilisés (30 j)
            </Text>
            <Text style={{ color: theme.text, fontSize: type.body, fontWeight: '700' }}>
              {m.vouchers30d.activated.toLocaleString('fr-FR')}
            </Text>
          </Row>
          <Row>
            <Text style={{ color: theme.textMuted, fontSize: type.body }}>
              Essais expirant sous 7 jours
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
              borderColor: theme.gold + '66',
              backgroundColor: theme.gold + '14',
              borderRadius: radius.md,
              padding: space.md,
            }}
          >
            <Ionicons name="alert-circle-outline" size={18} color={theme.gold} />
            <Text
              style={{ color: theme.text, fontSize: type.micro, flex: 1, lineHeight: 16 }}
            >
              {m.revenue.untieredActive} abonnement(s) actif(s) sans formule rattachée —
              activés avant la mise en place de la grille. Ils ne sont pas comptés dans le
              revenu récurrent ; réactivez-les depuis une demande pour les rattacher.
            </Text>
          </Row>
        </FadeIn>
      ) : null}
    </View>
  );
}

// ─── Demandes d'activation ───────────────────────────────────────────────────

function RequestsTab() {
  const qc = useQueryClient();
  const toast = useToast();
  const [confirming, setConfirming] = useState<AdminInvoice | null>(null);

  const query = useQuery({
    queryKey: ['admin', 'invoices', 'PENDING'],
    queryFn: () => api.admin.invoices({ status: 'PENDING', limit: 50 }),
    refetchInterval: 30_000,
  });

  const activate = useMutation({
    mutationFn: (invoice: AdminInvoice) =>
      api.subscriptions.activate(invoice.tenantId, invoice.periodDays),
    onSuccess: async () => {
      toast.success('Abonnement activé. Le client est notifié.');
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
        text="Aucune demande en attente. Tout est traité."
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
                  Demandé le {shortDate(inv.createdAt)}
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
                  {inv.billingPeriod === 'ANNUAL' ? 'annuel' : 'mensuel'}
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
              title={`Valider le paiement — ${inv.periodDays} jours`}
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
        title="Confirmer l’encaissement"
        message={
          confirming
            ? `Vous confirmez avoir reçu ${formatXof(confirming.amount)} de ${confirming.tenantName}. Son accès sera ouvert pour ${confirming.periodDays} jours.`
            : ''
        }
        confirmLabel="Activer"
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
  const suspended = tenant.status === 'SUSPENDED';
  return (
    <Card>
      <Row style={{ alignItems: 'flex-start' }}>
        <View style={{ flex: 1, paddingRight: space.md }}>
          <Row style={{ justifyContent: 'flex-start', gap: space.sm }}>
            <Text style={{ color: theme.text, fontSize: type.bodyLg, fontWeight: '700' }}>
              {tenant.name}
            </Text>
            {suspended ? <Badge label="Suspendu" tone="danger" /> : null}
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
        title={suspended ? 'Réactiver le compte' : 'Suspendre le compte'}
        variant={suspended ? 'ghost' : 'danger'}
        onPress={onToggle}
        loading={busy}
      />
    </Card>
  );
}

function AccountsTab() {
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
      toast.success('Statut mis à jour.');
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
            accessibilityLabel={s === 'tenants' ? 'Comptes' : 'Utilisateurs'}
            onPress={() => setScope(s)}
            style={{
              flex: 1,
              borderWidth: 1,
              borderColor: scope === s ? theme.primary : theme.border,
              backgroundColor: scope === s ? theme.primary + '1A' : theme.surfaceAlt,
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
              {s === 'tenants' ? 'Comptes' : 'Utilisateurs'}
            </Text>
          </Press>
        ))}
      </Row>

      <Field
        label="Rechercher"
        value={search}
        onChangeText={setSearch}
        placeholder={scope === 'tenants' ? 'Nom du compte' : 'E-mail ou nom'}
        autoCapitalize="none"
        autoCorrect={false}
        hint={
          search.length > 0 && search.trim().length < 3
            ? 'Au moins 3 caractères.'
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
          <Empty icon="business-outline" text="Aucun compte ne correspond." />
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
        <Empty icon="person-outline" text="Aucun utilisateur ne correspond." />
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
                      {u.tenantName} · {u.role} · dernière connexion{' '}
                      {shortDate(u.lastLoginAt)}
                    </Text>
                  </View>
                  <Badge
                    label={u.status === 'ACTIVE' ? 'Actif' : 'Suspendu'}
                    tone={u.status === 'ACTIVE' ? 'success' : 'danger'}
                  />
                </Row>
                {/* Le serveur refuse de toucher à un SUPER_ADMIN : ne pas
                    proposer le bouton évite un 403 sans explication. */}
                {u.role === 'SUPER_ADMIN' ? null : (
                  <Button
                    title={
                      u.status === 'SUSPENDED'
                        ? 'Réactiver l’utilisateur'
                        : 'Suspendre l’utilisateur'
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
          pending?.item.status === 'SUSPENDED' ? 'Réactiver l’accès' : 'Suspendre l’accès'
        }
        message={
          pending?.item.status === 'SUSPENDED'
            ? 'L’accès sera immédiatement rétabli.'
            : 'Les sessions ouvertes seront révoquées. Les tickets déjà vendus continuent de fonctionner sur le routeur.'
        }
        confirmLabel={pending?.item.status === 'SUSPENDED' ? 'Réactiver' : 'Suspendre'}
        busy={toggle.isPending}
        onConfirm={() => toggle.mutate()}
        onCancel={() => setPending(null)}
      />
    </View>
  );
}

// ─── Formules ────────────────────────────────────────────────────────────────

function TierEditor({ tier, onDone }: { tier: Tier; onDone: () => void }) {
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
      toast.success('Formule mise à jour. Les clients la verront immédiatement.');
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
      <Field label="Nom commercial" value={name} onChangeText={setName} maxLength={60} />
      <Row style={{ gap: space.md, alignItems: 'flex-start' }}>
        <View style={{ flex: 1 }}>
          <NumberField
            label="Prix mensuel (FCFA)"
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
        Les prix modifiés ici s’appliquent aux nouvelles demandes. Les factures déjà
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
export default function AdminScreen() {
  const navHeight = useBottomNavHeight();
  const router = useRouter();
  const { me } = useAuth();
  const [tab, setTab] = useState<Tab>('apercu');

  const pending = useQuery({
    queryKey: ['admin', 'invoices', 'PENDING'],
    queryFn: () => api.admin.invoices({ status: 'PENDING', limit: 50 }),
    enabled: me?.user.role === 'SUPER_ADMIN',
    refetchInterval: 30_000,
  });
  const pendingCount = pending.data?.items.length ?? 0;

  if (me && me.user.role !== 'SUPER_ADMIN') {
    return (
      <View style={{ flex: 1, backgroundColor: theme.bg }}>
        <AppHeader title="Administration" back />
        <ErrorState
          message="Cette section est réservée à l’administration de la plateforme."
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
            {TABS.map((t) => {
              const active = tab === t.key;
              const badge = t.key === 'demandes' && pendingCount > 0 ? pendingCount : null;
              return (
                <Press
                  key={t.key}
                  accessibilityRole="tab"
                  accessibilityLabel={t.label}
                  onPress={() => setTab(t.key)}
                  scaleTo={0.95}
                  style={{
                    flex: 1,
                    borderWidth: 1,
                    borderColor: active ? theme.primary : theme.border,
                    backgroundColor: active ? theme.primary + '1A' : theme.surfaceAlt,
                    borderRadius: radius.md,
                    paddingVertical: space.sm + 2,
                    alignItems: 'center',
                    gap: 3,
                  }}
                >
                  <View>
                    <Ionicons
                      name={t.icon}
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
                    {t.label}
                  </Text>
                </Press>
              );
            })}
          </Row>
        </View>

        {tab === 'apercu' ? <OverviewTab /> : null}
        {tab === 'demandes' ? <RequestsTab /> : null}
        {tab === 'comptes' ? <AccountsTab /> : null}
        {tab === 'formules' ? <TiersTab /> : null}
      </ScrollView>
      <BottomNav active="account" />
    </View>
  );
}
