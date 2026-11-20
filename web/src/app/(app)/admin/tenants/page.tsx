'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { apiGet } from '@/lib/api';
import { dateFr } from '@/lib/format';
import { Badge, EmptyState, ErrorBox, Input, Loading, PageHeader } from '@/components/ui';
import { AdminGuard, Table, Td, Th, Tr, statusTone } from '@/components/admin/primitives';
import type { AdminTenant, Page } from '@/components/admin/types';

function TenantsInner() {
  const [q, setQ] = useState('');
  const query = q.trim().length >= 3 ? q.trim() : undefined;

  const tenants = useQuery({
    queryKey: ['admin', 'tenants', query ?? ''],
    queryFn: () => apiGet<Page<AdminTenant>>('/admin/tenants', { ...(query ? { q: query } : {}), limit: 50 }),
  });

  const items = tenants.data?.items ?? [];

  return (
    <div>
      <PageHeader title="Comptes" />
      <div className="mb-4 max-w-sm">
        <Input
          placeholder="Rechercher (min. 3 caractères)…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
      </div>

      {tenants.isLoading ? (
        <Loading />
      ) : tenants.error ? (
        <ErrorBox message="Impossible de charger les comptes." />
      ) : items.length === 0 ? (
        <EmptyState>Aucun compte.</EmptyState>
      ) : (
        <Table>
          <thead>
            <tr>
              <Th>Compte</Th>
              <Th>Statut</Th>
              <Th>Formule</Th>
              <Th>Utilisateurs</Th>
              <Th>Routeurs</Th>
              <Th>Créé le</Th>
            </tr>
          </thead>
          <tbody>
            {items.map((t) => (
              <Tr key={t.id}>
                <Td>
                  <Link href={`/admin/tenants/${t.id}`} className="font-medium text-primary hover:underline">
                    {t.name}
                  </Link>
                  <div className="text-xs text-muted">{t.slug}</div>
                </Td>
                <Td>
                  <Badge tone={statusTone(t.status)}>{t.status}</Badge>
                </Td>
                <Td>
                  <Badge tone={statusTone(t.plan)}>{t.plan}</Badge>
                  {t.tierName && <span className="ml-2 text-xs text-muted">{t.tierName}</span>}
                </Td>
                <Td>{t.userCount}</Td>
                <Td>{t.routerCount}</Td>
                <Td className="text-muted">{dateFr(t.createdAt)}</Td>
              </Tr>
            ))}
          </tbody>
        </Table>
      )}
    </div>
  );
}

export default function AdminTenantsPage() {
  return (
    <AdminGuard roles={['SUPER_ADMIN']}>
      <TenantsInner />
    </AdminGuard>
  );
}
