'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiGet, apiPatch, apiPost, extractErrorMessage } from '@/lib/api';
import { dateFr, xof } from '@/lib/format';
import { Badge, Button, Card, EmptyState, ErrorBox, Loading, PageHeader } from '@/components/ui';
import {
  AdminGuard,
  Modal,
  Select,
  Table,
  Td,
  Th,
  Tr,
  Textarea,
  statusTone,
} from '@/components/admin/primitives';
import type {
  AdminTenantDetail,
  AdminTenantRouter,
  BillingPeriod,
  Page,
  SubscriptionPlan,
  TenantStatus,
} from '@/components/admin/types';

function TenantDetailInner({ id }: { id: string }) {
  const qc = useQueryClient();
  const detail = useQuery({
    queryKey: ['admin', 'tenant', id],
    queryFn: () => apiGet<AdminTenantDetail>(`/admin/tenants/${id}`),
  });

  const routers = useQuery({
    queryKey: ['admin', 'tenant', id, 'routers'],
    queryFn: () => apiGet<Page<AdminTenantRouter>>(`/admin/tenants/${id}/routers`, { limit: 100 }),
  });

  const [subOpen, setSubOpen] = useState(false);
  const invalidate = () => {
    void qc.invalidateQueries({ queryKey: ['admin', 'tenant', id] });
  };

  const statusMut = useMutation({
    mutationFn: (status: TenantStatus) => apiPatch(`/admin/tenants/${id}/status`, { status }),
    onSuccess: invalidate,
  });

  if (detail.isLoading) return <Loading />;
  if (detail.error || !detail.data) return <ErrorBox message="Compte introuvable." />;

  const t = detail.data;
  const sub = t.subscription;

  return (
    <div>
      <PageHeader
        title={t.name}
        action={
          <Link href="/admin/tenants" className="text-sm text-primary hover:underline">
            ← Comptes
          </Link>
        }
      />

      <div className="mb-6 grid gap-4 md:grid-cols-2">
        <Card>
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-lg font-semibold">Compte</h2>
            <Badge tone={statusTone(t.status)}>{t.status}</Badge>
          </div>
          <dl className="space-y-1.5 text-sm">
            <Row label="Slug" value={t.slug} />
            <Row label="Créé le" value={dateFr(t.createdAt)} />
            <Row label="Routeurs" value={String(t._count.routers)} />
          </dl>
          <div className="mt-4 flex gap-2">
            {t.status === 'ACTIVE' ? (
              <Button
                variant="danger"
                loading={statusMut.isPending}
                onClick={() => statusMut.mutate('SUSPENDED')}
              >
                Suspendre
              </Button>
            ) : (
              <Button
                loading={statusMut.isPending}
                onClick={() => statusMut.mutate('ACTIVE')}
              >
                Réactiver
              </Button>
            )}
          </div>
          {statusMut.error && <div className="mt-2"><ErrorBox message={extractErrorMessage(statusMut.error)} /></div>}
        </Card>

        <Card>
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-lg font-semibold">Abonnement</h2>
            <Button variant="ghost" onClick={() => setSubOpen(true)}>Modifier</Button>
          </div>
          {sub ? (
            <dl className="space-y-1.5 text-sm">
              <Row label="Plan" value={<Badge tone={statusTone(sub.plan)}>{sub.plan}</Badge>} />
              <Row label="Statut" value={<Badge tone={statusTone(sub.status)}>{sub.status}</Badge>} />
              <Row label="Formule" value={sub.tier ? `${sub.tier.name} · ${xof(sub.tier.monthlyXof)}/mois` : '—'} />
              <Row label="Périodicité" value={sub.billingPeriod ?? '—'} />
              <Row label="Fin de période" value={dateFr(sub.currentPeriodEnd)} />
            </dl>
          ) : (
            <EmptyState>Aucun abonnement.</EmptyState>
          )}
        </Card>
      </div>

      <h2 className="mb-3 text-lg font-semibold">Utilisateurs</h2>
      {t.users.length === 0 ? (
        <EmptyState>Aucun utilisateur.</EmptyState>
      ) : (
        <div className="mb-6">
          <Table>
            <thead>
              <tr>
                <Th>Email</Th>
                <Th>Rôle</Th>
                <Th>Statut</Th>
                <Th>Dernière connexion</Th>
              </tr>
            </thead>
            <tbody>
              {t.users.map((u) => (
                <Tr key={u.id}>
                  <Td>
                    {u.email}
                    {u.name && <div className="text-xs text-muted">{u.name}</div>}
                  </Td>
                  <Td><Badge tone="muted">{u.role}</Badge></Td>
                  <Td><Badge tone={statusTone(u.status)}>{u.status}</Badge></Td>
                  <Td className="text-muted">{dateFr(u.lastLoginAt)}</Td>
                </Tr>
              ))}
            </tbody>
          </Table>
        </div>
      )}

      <h2 className="mb-3 text-lg font-semibold">Routeurs</h2>
      {routers.isLoading ? (
        <Loading />
      ) : routers.error ? (
        <ErrorBox message="Impossible de charger les routeurs." />
      ) : (routers.data?.items.length ?? 0) === 0 ? (
        <EmptyState>Aucun routeur.</EmptyState>
      ) : (
        <div className="mb-6">
          <Table>
            <thead>
              <tr>
                <Th>Routeur</Th>
                <Th>Mode</Th>
                <Th>Santé</Th>
                <Th>Dernier contact</Th>
                <Th className="text-right">Actions</Th>
              </tr>
            </thead>
            <tbody>
              {(routers.data?.items ?? []).map((r) => (
                <RouterRow key={r.id} tenantId={id} router={r} />
              ))}
            </tbody>
          </Table>
        </div>
      )}

      <h2 className="mb-3 text-lg font-semibold">Dernières factures</h2>
      {t.invoices.length === 0 ? (
        <EmptyState>Aucune facture.</EmptyState>
      ) : (
        <Table>
          <thead>
            <tr>
              <Th>Montant</Th>
              <Th>Statut</Th>
              <Th>Formule</Th>
              <Th>Périodicité</Th>
              <Th>Créée le</Th>
              <Th>Payée le</Th>
            </tr>
          </thead>
          <tbody>
            {t.invoices.map((inv) => (
              <Tr key={inv.id}>
                <Td>{xof(inv.amount)}</Td>
                <Td><Badge tone={statusTone(inv.status)}>{inv.status}</Badge></Td>
                <Td>{inv.tier?.name ?? '—'}</Td>
                <Td>{inv.billingPeriod}</Td>
                <Td className="text-muted">{dateFr(inv.createdAt)}</Td>
                <Td className="text-muted">{dateFr(inv.paidAt)}</Td>
              </Tr>
            ))}
          </tbody>
        </Table>
      )}

      <SubscriptionModal
        open={subOpen}
        tenantId={id}
        current={sub}
        onClose={() => setSubOpen(false)}
        onDone={() => {
          setSubOpen(false);
          invalidate();
        }}
      />
    </div>
  );
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4">
      <dt className="text-muted">{label}</dt>
      <dd className="text-right text-fg">{value}</dd>
    </div>
  );
}

function RouterRow({ tenantId, router }: { tenantId: string; router: AdminTenantRouter }) {
  const [diagOpen, setDiagOpen] = useState(false);
  const diag = useQuery({
    queryKey: ['admin', 'router-diag', tenantId, router.id],
    queryFn: () => apiGet<Record<string, string>>(`/admin/tenants/${tenantId}/routers/${router.id}/diagnostics`),
    enabled: diagOpen,
  });

  const reboot = useMutation({
    mutationFn: async () => {
      const token = await apiPost<{ confirmToken: string; expiresInSeconds: number }>(
        `/admin/tenants/${tenantId}/routers/${router.id}/enter-diagnostic`,
      );
      return apiPost(`/admin/tenants/${tenantId}/routers/${router.id}/reboot`, {
        confirmToken: token.confirmToken,
      });
    },
  });

  return (
    <>
      <Tr>
        <Td>
          {router.alias || router.identity}
          <div className="text-xs text-muted">{router.model ?? '—'}</div>
        </Td>
        <Td><Badge tone="muted">{router.mode}</Badge></Td>
        <Td><Badge tone={statusTone(router.health)}>{router.health}</Badge></Td>
        <Td className="text-muted">{dateFr(router.lastHeartbeat)}</Td>
        <Td className="text-right">
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setDiagOpen(true)}>Diagnostics</Button>
            <Button
              variant="danger"
              loading={reboot.isPending}
              onClick={() => {
                if (window.confirm(`Redémarrer ${router.alias || router.identity} ?`)) reboot.mutate();
              }}
            >
              Redémarrer
            </Button>
          </div>
          {reboot.isSuccess && <div className="mt-1 text-xs text-success">Redémarrage demandé.</div>}
          {reboot.error && <div className="mt-1 text-xs text-danger">{extractErrorMessage(reboot.error)}</div>}
        </Td>
      </Tr>
      {diagOpen && (
        <tr>
          <td colSpan={5} className="border-b border-border/60 bg-surface2 px-4 py-3">
            {diag.isLoading ? (
              <Loading />
            ) : diag.error ? (
              <ErrorBox message="Diagnostics indisponibles." />
            ) : (
              <div className="grid grid-cols-2 gap-x-6 gap-y-1 text-xs sm:grid-cols-3">
                {Object.entries(diag.data ?? {}).map(([k, v]) => (
                  <div key={k} className="flex justify-between gap-2">
                    <span className="text-muted">{k}</span>
                    <span className="text-fg">{v}</span>
                  </div>
                ))}
              </div>
            )}
            <div className="mt-2 text-right">
              <Button variant="ghost" onClick={() => setDiagOpen(false)}>Fermer</Button>
            </div>
          </td>
        </tr>
      )}
    </>
  );
}

function SubscriptionModal({
  open,
  tenantId,
  current,
  onClose,
  onDone,
}: {
  open: boolean;
  tenantId: string;
  current: AdminTenantDetail['subscription'];
  onClose: () => void;
  onDone: () => void;
}) {
  const [plan, setPlan] = useState<SubscriptionPlan>(current?.plan ?? 'FREE');
  const [status, setStatus] = useState(current?.status ?? 'ACTIVE');
  const [billingPeriod, setBillingPeriod] = useState<BillingPeriod>(current?.billingPeriod ?? 'MONTHLY');
  const [note, setNote] = useState('');

  const mut = useMutation({
    mutationFn: () =>
      apiPatch(`/admin/tenants/${tenantId}/subscription`, {
        plan,
        status: status as 'ACTIVE' | 'PAST_DUE' | 'CANCELED',
        billingPeriod,
      }),
    onSuccess: onDone,
  });

  return (
    <Modal open={open} title="Modifier l'abonnement" onClose={onClose}>
      <div className="space-y-4">
        <Select label="Plan" value={plan} onChange={(e) => setPlan(e.target.value as SubscriptionPlan)}>
          <option value="FREE">FREE</option>
          <option value="PRO">PRO</option>
        </Select>
        <Select label="Statut" value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="ACTIVE">ACTIVE</option>
          <option value="PAST_DUE">PAST_DUE</option>
          <option value="CANCELED">CANCELED</option>
        </Select>
        <Select
          label="Périodicité"
          value={billingPeriod}
          onChange={(e) => setBillingPeriod(e.target.value as BillingPeriod)}
        >
          <option value="MONTHLY">Mensuel</option>
          <option value="ANNUAL">Annuel</option>
        </Select>
        <Textarea label="Note (optionnel)" value={note} onChange={(e) => setNote(e.target.value)} rows={2} />
        {mut.error && <ErrorBox message={extractErrorMessage(mut.error)} />}
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>Annuler</Button>
          <Button loading={mut.isPending} onClick={() => mut.mutate()}>Enregistrer</Button>
        </div>
      </div>
    </Modal>
  );
}

export default function AdminTenantDetailPage() {
  const params = useParams<{ id: string }>();
  const id = params.id;
  return (
    <AdminGuard roles={['SUPER_ADMIN']}>
      <TenantDetailInner id={id} />
    </AdminGuard>
  );
}
