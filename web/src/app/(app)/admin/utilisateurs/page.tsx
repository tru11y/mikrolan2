'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiGet, apiPatch, extractErrorMessage } from '@/lib/api';
import { dateFr } from '@/lib/format';
import { Badge, Button, EmptyState, ErrorBox, Input, Loading, PageHeader } from '@/components/ui';
import { AdminGuard, Table, Td, Th, Tr, statusTone } from '@/components/admin/primitives';
import type { AdminUser, Page, UserStatus } from '@/components/admin/types';

function UtilisateursInner() {
  const qc = useQueryClient();
  const [q, setQ] = useState('');
  const query = q.trim().length >= 3 ? q.trim() : undefined;

  const users = useQuery({
    queryKey: ['admin', 'users', query ?? ''],
    queryFn: () => apiGet<Page<AdminUser>>('/admin/users', { ...(query ? { q: query } : {}), limit: 50 }),
  });

  const setStatus = useMutation({
    mutationFn: ({ id, status }: { id: string; status: UserStatus }) =>
      apiPatch(`/admin/users/${id}/status`, { status }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['admin', 'users'] }),
  });

  const items = users.data?.items ?? [];

  return (
    <div>
      <PageHeader title="Utilisateurs" />
      <div className="mb-4 max-w-sm">
        <Input placeholder="Rechercher (min. 3 caractères)…" value={q} onChange={(e) => setQ(e.target.value)} />
      </div>

      {setStatus.error && <div className="mb-3"><ErrorBox message={extractErrorMessage(setStatus.error)} /></div>}

      {users.isLoading ? (
        <Loading />
      ) : users.error ? (
        <ErrorBox message="Impossible de charger les utilisateurs." />
      ) : items.length === 0 ? (
        <EmptyState>Aucun utilisateur.</EmptyState>
      ) : (
        <Table>
          <thead>
            <tr>
              <Th>Email</Th>
              <Th>Compte</Th>
              <Th>Rôle</Th>
              <Th>Statut</Th>
              <Th>Dernière connexion</Th>
              <Th className="text-right">Action</Th>
            </tr>
          </thead>
          <tbody>
            {items.map((u) => {
              const active = u.status === 'ACTIVE';
              const isSuperAdmin = u.role === 'SUPER_ADMIN';
              return (
                <Tr key={u.id}>
                  <Td>
                    {u.email}
                    {u.name && <div className="text-xs text-muted">{u.name}</div>}
                  </Td>
                  <Td>{u.tenantName}</Td>
                  <Td><Badge tone="muted">{u.role}</Badge></Td>
                  <Td><Badge tone={statusTone(u.status)}>{u.status}</Badge></Td>
                  <Td className="text-muted">{dateFr(u.lastLoginAt)}</Td>
                  <Td className="text-right">
                    <Button
                      variant={active ? 'danger' : 'primary'}
                      disabled={isSuperAdmin}
                      loading={setStatus.isPending && setStatus.variables?.id === u.id}
                      onClick={() => setStatus.mutate({ id: u.id, status: active ? 'SUSPENDED' : 'ACTIVE' })}
                    >
                      {active ? 'Suspendre' : 'Réactiver'}
                    </Button>
                  </Td>
                </Tr>
              );
            })}
          </tbody>
        </Table>
      )}
    </div>
  );
}

export default function AdminUtilisateursPage() {
  return (
    <AdminGuard roles={['SUPER_ADMIN']}>
      <UtilisateursInner />
    </AdminGuard>
  );
}
