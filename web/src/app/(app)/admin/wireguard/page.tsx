'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiGet, apiPost, extractErrorMessage } from '@/lib/api';
import { bytes, dateFr } from '@/lib/format';
import { Badge, Button, EmptyState, ErrorBox, Input, Loading, PageHeader, Stat } from '@/components/ui';
import { AdminGuard, Modal, Select, Table, Td, Th, Tr, Textarea, statusTone } from '@/components/admin/primitives';
import type { WgPeerRow, WgPeersResponse } from '@/components/admin/types';

const STALENESS = ['', 'STALE_24H', 'NEVER_CONNECTED'] as const;

function WireguardInner() {
  const qc = useQueryClient();
  const [staleness, setStaleness] = useState('');
  const [q, setQ] = useState('');
  const [revokeTarget, setRevokeTarget] = useState<WgPeerRow | null>(null);
  const query = q.trim().length >= 3 ? q.trim() : undefined;

  const peers = useQuery({
    queryKey: ['admin', 'wg', staleness, query ?? ''],
    queryFn: () =>
      apiGet<WgPeersResponse>('/admin/wireguard/peers', {
        ...(staleness ? { staleness } : {}),
        ...(query ? { q: query } : {}),
        limit: 100,
      }),
  });

  const invalidate = () => void qc.invalidateQueries({ queryKey: ['admin', 'wg'] });

  const resync = useMutation({
    mutationFn: (routerId: string) => apiPost(`/admin/wireguard/peers/${routerId}/resync`),
    onSuccess: invalidate,
  });

  const data = peers.data;
  const items = data?.items ?? [];
  const s = data?.summary;

  return (
    <div>
      <PageHeader title="WireGuard" />

      {s && (
        <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Stat label="Peers" value={s.total} sub={`${s.healthy} sains`} />
          <Stat label="Obsolètes 24h" value={s.stale24h} />
          <Stat label="Jamais connectés" value={s.neverConnected} />
          <Stat label="En erreur" value={s.error} sub={`${s.revoked} révoqués`} />
        </div>
      )}

      <div className="mb-4 flex flex-wrap gap-3">
        <div className="w-64"><Input placeholder="Rechercher (min. 3)…" value={q} onChange={(e) => setQ(e.target.value)} /></div>
        <div className="w-56"><Select value={staleness} onChange={(e) => setStaleness(e.target.value)}>
          {STALENESS.map((v) => <option key={v} value={v}>{v === '' ? 'Toutes fraîcheurs' : v}</option>)}
        </Select></div>
      </div>

      {resync.error && <div className="mb-3"><ErrorBox message={extractErrorMessage(resync.error)} /></div>}

      {peers.isLoading ? (
        <Loading />
      ) : peers.error ? (
        <ErrorBox message="Impossible de charger les peers." />
      ) : items.length === 0 ? (
        <EmptyState>Aucun peer WireGuard.</EmptyState>
      ) : (
        <Table>
          <thead>
            <tr>
              <Th>Routeur</Th>
              <Th>Compte</Th>
              <Th>Statut</Th>
              <Th>IP WG</Th>
              <Th>Trafic (rx/tx)</Th>
              <Th>Dernier handshake</Th>
              <Th className="text-right">Actions</Th>
            </tr>
          </thead>
          <tbody>
            {items.map((p) => (
              <Tr key={p.id}>
                <Td>
                  {p.router.alias || p.router.identity}
                  <div className="text-xs text-muted">{p.router.mode}</div>
                </Td>
                <Td>{p.tenant.name}</Td>
                <Td>
                  <Badge tone={statusTone(p.status)}>{p.status}</Badge>
                  {p.staleness !== 'OK' && <span className="ml-1"><Badge tone={statusTone(p.staleness)}>{p.staleness}</Badge></span>}
                </Td>
                <Td className="font-mono text-xs">{p.wgIp}:{p.allocatedPort}</Td>
                <Td className="text-muted">{bytes(p.rxBytes ?? 0)} / {bytes(p.txBytes ?? 0)}</Td>
                <Td className="text-muted">{dateFr(p.lastHandshakeAt)}</Td>
                <Td className="text-right">
                  <div className="flex justify-end gap-2">
                    <Button
                      variant="ghost"
                      loading={resync.isPending && resync.variables === p.router.id}
                      onClick={() => resync.mutate(p.router.id)}
                    >
                      Resync
                    </Button>
                    <Button variant="danger" onClick={() => setRevokeTarget(p)} disabled={p.status === 'REVOKED'}>
                      Révoquer
                    </Button>
                  </div>
                </Td>
              </Tr>
            ))}
          </tbody>
        </Table>
      )}

      {revokeTarget && (
        <RevokeModal
          peer={revokeTarget}
          onClose={() => setRevokeTarget(null)}
          onDone={() => {
            setRevokeTarget(null);
            invalidate();
          }}
        />
      )}
    </div>
  );
}

function RevokeModal({
  peer,
  onClose,
  onDone,
}: {
  peer: WgPeerRow;
  onClose: () => void;
  onDone: () => void;
}) {
  const expected = peer.router.alias || peer.router.identity;
  const [reason, setReason] = useState('');
  const [confirmName, setConfirmName] = useState('');

  const mut = useMutation({
    mutationFn: () =>
      apiPost(`/admin/wireguard/peers/${peer.router.id}/revoke`, { reason: reason.trim(), confirmName: confirmName.trim() }),
    onSuccess: onDone,
  });

  return (
    <Modal open title="Révoquer le peer" onClose={onClose}>
      <div className="space-y-4">
        <p className="text-sm text-muted">
          Cette action révoque l&apos;accès distant du routeur <b className="text-fg">{expected}</b>. Saisissez son
          nom pour confirmer.
        </p>
        <Textarea label="Raison" value={reason} onChange={(e) => setReason(e.target.value)} rows={2} />
        <Input label={`Confirmer le nom du routeur (« ${expected} »)`} value={confirmName} onChange={(e) => setConfirmName(e.target.value)} />
        {mut.error && <ErrorBox message={extractErrorMessage(mut.error)} />}
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>Annuler</Button>
          <Button
            variant="danger"
            loading={mut.isPending}
            disabled={confirmName.trim() !== expected || reason.trim().length === 0}
            onClick={() => mut.mutate()}
          >
            Révoquer
          </Button>
        </div>
      </div>
    </Modal>
  );
}

export default function AdminWireguardPage() {
  return (
    <AdminGuard roles={['SUPER_ADMIN']}>
      <WireguardInner />
    </AdminGuard>
  );
}
