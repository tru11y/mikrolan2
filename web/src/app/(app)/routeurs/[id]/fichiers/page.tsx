'use client';

import { useState } from 'react';
import { useParams } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiDelete, apiGet, extractErrorMessage } from '@/lib/api';
import { xof, dateFr } from '@/lib/format';
import { Button, Card, EmptyState, ErrorBox, Loading } from '@/components/ui';
import { BatchStatusBadge, type VoucherBatch } from '@/components/routeurs/shared';

type BatchDeletionPreview = {
  batchId: string | null;
  total: number;
  eligible: number;
  keptForHistory: number;
  connectedNow: number;
};

export default function RouterFichiersPage() {
  const { id } = useParams<{ id: string }>();
  const qc = useQueryClient();
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [preview, setPreview] = useState<BatchDeletionPreview | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const batches = useQuery({
    queryKey: ['batches', id],
    queryFn: () => apiGet<VoucherBatch[]>(`/routers/${id}/vouchers/batches`),
    enabled: Boolean(id),
  });

  const openPreview = useMutation({
    mutationFn: (batchId: string) =>
      apiGet<BatchDeletionPreview>(`/routers/${id}/vouchers/batches/${batchId}/deletion-preview`),
    onSuccess: (data, batchId) => {
      setConfirmId(batchId);
      setPreview(data);
    },
    onError: (e) => setActionError(extractErrorMessage(e)),
  });

  const deleteBatch = useMutation({
    mutationFn: (batchId: string) =>
      apiDelete<{ deleted: number }>(`/routers/${id}/vouchers/batches/${batchId}`),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ['batches', id] });
      setConfirmId(null);
      setPreview(null);
    },
    onError: (e) => setActionError(extractErrorMessage(e)),
  });

  const list = batches.data ?? [];

  return (
    <div>
      <h2 className="mb-4 text-lg font-semibold">Lots de tickets</h2>

      {actionError && (
        <div className="mb-4">
          <ErrorBox message={actionError} />
        </div>
      )}

      {batches.isLoading ? (
        <Loading />
      ) : batches.error ? (
        <ErrorBox message={extractErrorMessage(batches.error)} />
      ) : list.length === 0 ? (
        <EmptyState>Aucun lot généré pour ce routeur.</EmptyState>
      ) : (
        <div className="space-y-2">
          {list.map((b) => (
            <Card key={b.id} className="space-y-3">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-fg">Lot #{b.seq}</span>
                    <BatchStatusBadge status={b.status} />
                  </div>
                  <div className="mt-0.5 text-xs text-muted">
                    {b.plan.name} · {xof(b.plan.priceXof)} · {dateFr(b.createdAt)}
                  </div>
                  <div className="mt-1 text-xs text-muted">
                    {b.provisionedCount} disponible(s) · {b.voucherCount} en base ·{' '}
                    {b.quantity} demandé(s)
                  </div>
                </div>
                <Button
                  variant="ghost"
                  onClick={() => {
                    setActionError(null);
                    openPreview.mutate(b.id);
                  }}
                  loading={openPreview.isPending && openPreview.variables === b.id}
                >
                  Supprimer
                </Button>
              </div>

              {confirmId === b.id && preview && (
                <div className="space-y-2 rounded-xl border border-danger/40 bg-danger/5 p-3 text-sm">
                  <div className="text-fg">
                    {preview.eligible} ticket(s) seront supprimés.
                  </div>
                  {preview.keptForHistory > 0 && (
                    <div className="text-muted">
                      {preview.keptForHistory} conservé(s) pour l&apos;historique (déjà vendus).
                    </div>
                  )}
                  {preview.connectedNow > 0 && (
                    <div className="text-muted">
                      {preview.connectedNow} conservé(s) (client connecté).
                    </div>
                  )}
                  <div className="flex gap-2 pt-1">
                    <Button
                      variant="danger"
                      onClick={() => deleteBatch.mutate(b.id)}
                      loading={deleteBatch.isPending}
                    >
                      Confirmer la suppression
                    </Button>
                    <Button
                      variant="ghost"
                      onClick={() => {
                        setConfirmId(null);
                        setPreview(null);
                      }}
                    >
                      Annuler
                    </Button>
                  </div>
                </div>
              )}
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
