'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { apiGet } from '@/lib/api';
import { dateFr, xof } from '@/lib/format';
import { Badge, EmptyState, ErrorBox, Loading, PageHeader } from '@/components/ui';
import { AdminGuard, Modal, Select, Table, Td, Th, Tr, statusTone } from '@/components/admin/primitives';
import type { AdminInvoice, Page, PaymentProof } from '@/components/admin/types';

const STATUSES = ['', 'PENDING', 'PAID', 'FAILED', 'REFUNDED'] as const;

function FacturesInner() {
  const [status, setStatus] = useState('');
  const [proofsFor, setProofsFor] = useState<AdminInvoice | null>(null);

  const invoices = useQuery({
    queryKey: ['admin', 'invoices', status],
    queryFn: () =>
      apiGet<Page<AdminInvoice>>('/admin/invoices', { ...(status ? { status } : {}), limit: 50 }),
  });

  const items = invoices.data?.items ?? [];

  return (
    <div>
      <PageHeader
        title="Factures"
        action={
          <div className="w-48">
            <Select value={status} onChange={(e) => setStatus(e.target.value)}>
              {STATUSES.map((s) => (
                <option key={s} value={s}>{s === '' ? 'Tous les statuts' : s}</option>
              ))}
            </Select>
          </div>
        }
      />

      {invoices.isLoading ? (
        <Loading />
      ) : invoices.error ? (
        <ErrorBox message="Impossible de charger les factures." />
      ) : items.length === 0 ? (
        <EmptyState>Aucune facture.</EmptyState>
      ) : (
        <Table>
          <thead>
            <tr>
              <Th>Compte</Th>
              <Th>Montant</Th>
              <Th>Statut</Th>
              <Th>Formule</Th>
              <Th>Périodicité</Th>
              <Th>Note</Th>
              <Th>Créée le</Th>
              <Th className="text-right">Preuves</Th>
            </tr>
          </thead>
          <tbody>
            {items.map((inv) => (
              <Tr key={inv.id}>
                <Td>{inv.tenantName}</Td>
                <Td>{xof(inv.amount)}</Td>
                <Td><Badge tone={statusTone(inv.status)}>{inv.status}</Badge></Td>
                <Td>{inv.tierName ?? '—'}</Td>
                <Td>{inv.billingPeriod}</Td>
                <Td className="max-w-[16rem] truncate text-muted" >{inv.note ?? '—'}</Td>
                <Td className="text-muted">{dateFr(inv.createdAt)}</Td>
                <Td className="text-right">
                  <button className="text-sm text-primary hover:underline" onClick={() => setProofsFor(inv)}>
                    Voir
                  </button>
                </Td>
              </Tr>
            ))}
          </tbody>
        </Table>
      )}

      {proofsFor && <ProofsModal invoice={proofsFor} onClose={() => setProofsFor(null)} />}
    </div>
  );
}

function ProofsModal({ invoice, onClose }: { invoice: AdminInvoice; onClose: () => void }) {
  const proofs = useQuery({
    queryKey: ['admin', 'invoice-proofs', invoice.id],
    queryFn: () => apiGet<PaymentProof[]>(`/admin/invoices/${invoice.id}/proofs`),
  });

  return (
    <Modal open title={`Preuves · ${invoice.tenantName}`} onClose={onClose}>
      {proofs.isLoading ? (
        <Loading />
      ) : proofs.error ? (
        <ErrorBox message="Impossible de charger les preuves." />
      ) : (proofs.data?.length ?? 0) === 0 ? (
        <EmptyState>Aucune preuve de paiement.</EmptyState>
      ) : (
        <div className="space-y-3">
          {(proofs.data ?? []).map((p) => (
            <div key={p.id} className="rounded-xl border border-border bg-surface2 p-3">
              <div className="mb-2 flex items-center justify-between">
                <Badge tone="primary">{p.method}</Badge>
                <span className="text-xs text-muted">{dateFr(p.createdAt)}</span>
              </div>
              {p.note && <div className="mb-2 text-sm text-muted">{p.note}</div>}
              <a href={p.imageUrl} target="_blank" rel="noreferrer" className="text-sm text-primary hover:underline">
                Ouvrir l&apos;image
              </a>
            </div>
          ))}
        </div>
      )}
    </Modal>
  );
}

export default function AdminFacturesPage() {
  return (
    <AdminGuard roles={['SUPER_ADMIN']}>
      <FacturesInner />
    </AdminGuard>
  );
}
