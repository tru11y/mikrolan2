'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiGet, apiPatch, apiPost, extractErrorMessage } from '@/lib/api';
import { xof } from '@/lib/format';
import { Badge, Button, Card, EmptyState, ErrorBox, Input, Loading, PageHeader } from '@/components/ui';
import { AdminGuard, Modal, statusTone } from '@/components/admin/primitives';
import type { CreateTierInput, Tier, TierPatch } from '@/components/admin/types';

function AbonnementsInner() {
  const qc = useQueryClient();
  const tiers = useQuery({
    queryKey: ['admin', 'tiers'],
    queryFn: () => apiGet<Tier[]>('/admin/tiers'),
  });

  const [editing, setEditing] = useState<Tier | null>(null);
  const [creating, setCreating] = useState(false);
  const invalidate = () => void qc.invalidateQueries({ queryKey: ['admin', 'tiers'] });

  const toggle = useMutation({
    mutationFn: (t: Tier) => apiPatch<Tier>(`/admin/tiers/${t.id}`, { active: !t.active } satisfies TierPatch),
    onSuccess: invalidate,
  });

  return (
    <div>
      <PageHeader
        title="Abonnements"
        action={<Button onClick={() => setCreating(true)}>Nouvelle formule</Button>}
      />

      {tiers.isLoading ? (
        <Loading />
      ) : tiers.error ? (
        <ErrorBox message="Impossible de charger les formules." />
      ) : (tiers.data?.length ?? 0) === 0 ? (
        <EmptyState>Aucune formule.</EmptyState>
      ) : (
        <div className="mb-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {(tiers.data ?? []).map((t) => (
            <Card key={t.id}>
              <div className="mb-2 flex items-center justify-between">
                <div className="font-semibold text-fg">{t.name}</div>
                <Badge tone={t.active ? 'success' : 'muted'}>{t.active ? 'Active' : 'Archivée'}</Badge>
              </div>
              <div className="text-xs text-muted">clé: {t.key}</div>
              <div className="mt-3 text-2xl font-bold text-fg">{xof(t.monthlyXof)}</div>
              <div className="text-xs text-muted">/mois · {t.annualDiscount}% remise annuelle</div>
              <div className="mt-2 text-xs text-muted">
                Routeurs: {t.routerLimit ?? 'illimité'}
                {t.remoteAccess ? ' · accès distant' : ''}
                {t.a4Printing ? ' · A4' : ''}
              </div>
              <div className="mt-4 flex gap-2">
                <Button variant="ghost" onClick={() => setEditing(t)}>Modifier</Button>
                <Button
                  variant={t.active ? 'danger' : 'primary'}
                  loading={toggle.isPending && toggle.variables?.id === t.id}
                  onClick={() => toggle.mutate(t)}
                >
                  {t.active ? 'Archiver' : 'Activer'}
                </Button>
              </div>
            </Card>
          ))}
        </div>
      )}

      <ActivationCard />

      {editing && (
        <TierModal
          tier={editing}
          onClose={() => setEditing(null)}
          onDone={() => {
            setEditing(null);
            invalidate();
          }}
        />
      )}
      {creating && (
        <TierModal
          tier={null}
          onClose={() => setCreating(false)}
          onDone={() => {
            setCreating(false);
            invalidate();
          }}
        />
      )}
    </div>
  );
}

function ActivationCard() {
  const [tenantId, setTenantId] = useState('');
  const [periodDays, setPeriodDays] = useState('');

  const activate = useMutation({
    mutationFn: () =>
      apiPost(`/subscriptions/${tenantId.trim()}/activate`, periodDays ? { periodDays: Number(periodDays) } : {}),
  });
  const deactivate = useMutation({
    mutationFn: () => apiPost(`/subscriptions/${tenantId.trim()}/deactivate`, {}),
  });

  const valid = tenantId.trim().length > 0;

  return (
    <Card>
      <h2 className="mb-1 text-lg font-semibold">Activation manuelle</h2>
      <p className="mb-4 text-sm text-muted">
        Active ou désactive l&apos;abonnement d&apos;un compte à partir de son identifiant.
      </p>
      <div className="grid gap-3 sm:grid-cols-2">
        <Input label="ID du compte" placeholder="uuid" value={tenantId} onChange={(e) => setTenantId(e.target.value)} />
        <Input
          label="Durée (jours, optionnel)"
          type="number"
          placeholder="30"
          value={periodDays}
          onChange={(e) => setPeriodDays(e.target.value)}
        />
      </div>
      <div className="mt-4 flex gap-2">
        <Button disabled={!valid} loading={activate.isPending} onClick={() => activate.mutate()}>
          Activer
        </Button>
        <Button variant="danger" disabled={!valid} loading={deactivate.isPending} onClick={() => deactivate.mutate()}>
          Désactiver
        </Button>
      </div>
      {activate.isSuccess && <div className="mt-2 text-sm text-success">Abonnement activé.</div>}
      {deactivate.isSuccess && <div className="mt-2 text-sm text-success">Abonnement désactivé.</div>}
      {activate.error && <div className="mt-2"><ErrorBox message={extractErrorMessage(activate.error)} /></div>}
      {deactivate.error && <div className="mt-2"><ErrorBox message={extractErrorMessage(deactivate.error)} /></div>}
    </Card>
  );
}

function TierModal({
  tier,
  onClose,
  onDone,
}: {
  tier: Tier | null;
  onClose: () => void;
  onDone: () => void;
}) {
  const [key, setKey] = useState(tier?.key ?? '');
  const [name, setName] = useState(tier?.name ?? '');
  const [monthlyXof, setMonthlyXof] = useState(String(tier?.monthlyXof ?? ''));
  const [annualDiscount, setAnnualDiscount] = useState(String(tier?.annualDiscount ?? '20'));
  const [routerLimit, setRouterLimit] = useState(tier?.routerLimit != null ? String(tier.routerLimit) : '');

  const mut = useMutation({
    mutationFn: () => {
      const routerLimitVal = routerLimit.trim() === '' ? null : Number(routerLimit);
      if (tier) {
        const patch: TierPatch = {
          name: name.trim(),
          monthlyXof: Number(monthlyXof),
          annualDiscount: Number(annualDiscount),
          routerLimit: routerLimitVal,
        };
        return apiPatch<Tier>(`/admin/tiers/${tier.id}`, patch);
      }
      const body: CreateTierInput = {
        key: key.trim(),
        name: name.trim(),
        monthlyXof: Number(monthlyXof),
        annualDiscount: Number(annualDiscount),
        routerLimit: routerLimitVal,
        features: [],
      };
      return apiPost<Tier>('/admin/tiers', body);
    },
    onSuccess: onDone,
  });

  return (
    <Modal open title={tier ? 'Modifier la formule' : 'Nouvelle formule'} onClose={onClose}>
      <div className="space-y-4">
        {!tier && (
          <Input label="Clé (minuscules, chiffres, tirets)" value={key} onChange={(e) => setKey(e.target.value)} />
        )}
        <Input label="Nom" value={name} onChange={(e) => setName(e.target.value)} />
        <Input label="Prix mensuel (FCFA)" type="number" value={monthlyXof} onChange={(e) => setMonthlyXof(e.target.value)} />
        <Input label="Remise annuelle (%)" type="number" value={annualDiscount} onChange={(e) => setAnnualDiscount(e.target.value)} />
        <Input
          label="Limite de routeurs (vide = illimité)"
          type="number"
          value={routerLimit}
          onChange={(e) => setRouterLimit(e.target.value)}
        />
        {mut.error && <ErrorBox message={extractErrorMessage(mut.error)} />}
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>Annuler</Button>
          <Button loading={mut.isPending} onClick={() => mut.mutate()}>
            {tier ? 'Enregistrer' : 'Créer'}
          </Button>
        </div>
      </div>
    </Modal>
  );
}

export default function AdminAbonnementsPage() {
  return (
    <AdminGuard roles={['SUPER_ADMIN']}>
      <AbonnementsInner />
    </AdminGuard>
  );
}
