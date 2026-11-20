'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiDelete, apiGet, apiPatch, apiPost, extractErrorMessage } from '@/lib/api';
import { Badge, Button, Card, EmptyState, ErrorBox, Loading, PageHeader } from '@/components/ui';
import { xof } from '@/lib/format';
import { RouterPicker } from '@/components/tickets/RouterPicker';
import { PlanForm } from '@/components/tickets/PlanForm';
import { Modal } from '@/components/tickets/Modal';
import {
  durationLabel,
  type CreatePlanPayload,
  type PlanFull,
} from '@/components/tickets/types';

export default function ForfaitsPage() {
  const qc = useQueryClient();
  const [routerId, setRouterId] = useState<string | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<PlanFull | null>(null);
  const [toDelete, setToDelete] = useState<PlanFull | null>(null);

  const plans = useQuery({
    queryKey: ['plans', routerId],
    queryFn: () => apiGet<PlanFull[]>(`/routers/${routerId}/plans`),
    enabled: Boolean(routerId),
  });

  const invalidate = () => qc.invalidateQueries({ queryKey: ['plans', routerId] });

  const saveMutation = useMutation({
    mutationFn: (payload: CreatePlanPayload) =>
      editing
        ? apiPatch<PlanFull>(`/routers/${routerId}/plans/${editing.id}`, payload)
        : apiPost<PlanFull>(`/routers/${routerId}/plans`, payload),
    onSuccess: () => {
      invalidate();
      setFormOpen(false);
      setEditing(null);
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (plan: PlanFull) => apiDelete<{ deleted: boolean }>(`/routers/${routerId}/plans/${plan.id}`),
    onSuccess: () => {
      invalidate();
      setToDelete(null);
    },
  });

  function openCreate() {
    setEditing(null);
    setFormOpen(true);
  }
  function openEdit(plan: PlanFull) {
    setEditing(plan);
    setFormOpen(true);
  }

  const list = plans.data ?? [];

  return (
    <div>
      <PageHeader
        title="Forfaits"
        action={
          <Button disabled={!routerId} onClick={openCreate}>
            Nouveau forfait
          </Button>
        }
      />

      <RouterPicker value={routerId} onChange={setRouterId} />

      {routerId && (
        <>
          {plans.isLoading ? (
            <Loading />
          ) : plans.error ? (
            <ErrorBox message={extractErrorMessage(plans.error)} />
          ) : list.length === 0 ? (
            <EmptyState>Aucun forfait pour ce routeur. Créez-en un.</EmptyState>
          ) : (
            <div className="space-y-3">
              {list.map((p) => (
                <Card key={p.id}>
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="font-semibold text-fg">{p.name}</span>
                        {p.status !== 'ACTIVE' && <Badge tone="muted">Archivé</Badge>}
                      </div>
                      <div className="mt-1 text-sm text-muted">
                        {xof(p.priceXof)} · {durationLabel(p.durationMinutes)} · {p.sharedUsers} appareil(s)
                        {p.dataLimitMb ? ` · ${p.dataLimitMb} Mo` : ''}
                        {p.downloadKbps ? ` · ↓${Math.round(p.downloadKbps / 1000)} Mbps` : ''}
                        {p.uploadKbps ? ` · ↑${Math.round(p.uploadKbps / 1000)} Mbps` : ''}
                      </div>
                    </div>
                    <div className="flex gap-2">
                      <Button variant="ghost" className="px-3 py-1.5 text-xs" onClick={() => openEdit(p)}>
                        Modifier
                      </Button>
                      <Button
                        variant="danger"
                        className="px-3 py-1.5 text-xs"
                        onClick={() => setToDelete(p)}
                      >
                        Supprimer
                      </Button>
                    </div>
                  </div>
                </Card>
              ))}
            </div>
          )}
        </>
      )}

      {formOpen && routerId && (
        <PlanForm
          initial={editing}
          busy={saveMutation.isPending}
          errorMessage={saveMutation.error ? extractErrorMessage(saveMutation.error) : null}
          onSubmit={(payload) => saveMutation.mutate(payload)}
          onClose={() => {
            setFormOpen(false);
            setEditing(null);
          }}
        />
      )}

      {toDelete && (
        <Modal title="Supprimer le forfait" onClose={() => setToDelete(null)}>
          <div className="space-y-4 text-sm">
            <p className="text-muted">
              Supprimer le forfait « <span className="text-fg">{toDelete.name}</span> » ? Cette action
              est irréversible.
            </p>
            {deleteMutation.error && <ErrorBox message={extractErrorMessage(deleteMutation.error)} />}
            <div className="flex justify-end gap-2">
              <Button variant="ghost" onClick={() => setToDelete(null)}>
                Annuler
              </Button>
              <Button
                variant="danger"
                loading={deleteMutation.isPending}
                onClick={() => deleteMutation.mutate(toDelete)}
              >
                Supprimer
              </Button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
