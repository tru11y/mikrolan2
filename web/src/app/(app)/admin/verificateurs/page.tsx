'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiDelete, apiGet, apiPatch, apiPost, extractErrorMessage } from '@/lib/api';
import { dateFr } from '@/lib/format';
import type { RouterSummary } from '@/lib/types';
import { Badge, Button, EmptyState, ErrorBox, Input, Loading, PageHeader } from '@/components/ui';
import { AdminGuard, Modal, Select, Table, Td, Th, Tr, statusTone } from '@/components/admin/primitives';
import type { CreateVerifierInput, Page, VerifierItem } from '@/components/admin/types';

function VerificateursInner() {
  const qc = useQueryClient();
  const [creating, setCreating] = useState(false);
  const [resetFor, setResetFor] = useState<VerifierItem | null>(null);

  const verifiers = useQuery({
    queryKey: ['verifiers'],
    queryFn: () => apiGet<Page<VerifierItem>>('/ticket-verifiers', { limit: 100 }),
  });
  const routers = useQuery({
    queryKey: ['routers'],
    queryFn: () => apiGet<RouterSummary[]>('/routers'),
  });

  const invalidate = () => void qc.invalidateQueries({ queryKey: ['verifiers'] });

  const setStatus = useMutation({
    mutationFn: ({ id, status }: { id: string; status: 'ACTIVE' | 'SUSPENDED' }) =>
      apiPatch(`/ticket-verifiers/${id}/status`, { status }),
    onSuccess: invalidate,
  });
  const assign = useMutation({
    mutationFn: ({ id, routerId }: { id: string; routerId: string }) =>
      apiPatch(`/ticket-verifiers/${id}/assignment`, { routerId }),
    onSuccess: invalidate,
  });
  const remove = useMutation({
    mutationFn: (id: string) => apiDelete(`/ticket-verifiers/${id}`),
    onSuccess: invalidate,
  });

  const items = verifiers.data?.items ?? [];
  const routerList = routers.data ?? [];

  return (
    <div>
      <PageHeader
        title="Vérificateurs"
        action={<Button onClick={() => setCreating(true)}>Nouveau vérificateur</Button>}
      />

      {(setStatus.error || assign.error || remove.error) && (
        <div className="mb-3">
          <ErrorBox message={extractErrorMessage(setStatus.error || assign.error || remove.error)} />
        </div>
      )}

      {verifiers.isLoading ? (
        <Loading />
      ) : verifiers.error ? (
        <ErrorBox message="Impossible de charger les vérificateurs." />
      ) : items.length === 0 ? (
        <EmptyState>Aucun vérificateur. Créez-en un pour contrôler les tickets au comptoir.</EmptyState>
      ) : (
        <Table>
          <thead>
            <tr>
              <Th>Vérificateur</Th>
              <Th>Statut</Th>
              <Th>Routeur assigné</Th>
              <Th>Dernière connexion</Th>
              <Th className="text-right">Actions</Th>
            </tr>
          </thead>
          <tbody>
            {items.map((v) => {
              const active = v.status === 'ACTIVE';
              return (
                <Tr key={v.id}>
                  <Td>
                    {v.email}
                    {v.name && <div className="text-xs text-muted">{v.name}</div>}
                  </Td>
                  <Td><Badge tone={statusTone(v.status)}>{v.status}</Badge></Td>
                  <Td>
                    <Select
                      value={v.assignment?.routerId ?? ''}
                      onChange={(e) => {
                        if (e.target.value) assign.mutate({ id: v.id, routerId: e.target.value });
                      }}
                    >
                      <option value="">— Aucun —</option>
                      {routerList.map((r) => (
                        <option key={r.id} value={r.id}>{r.alias || r.identity}</option>
                      ))}
                    </Select>
                  </Td>
                  <Td className="text-muted">{dateFr(v.lastLoginAt)}</Td>
                  <Td className="text-right">
                    <div className="flex flex-wrap justify-end gap-2">
                      <Button
                        variant={active ? 'danger' : 'primary'}
                        loading={setStatus.isPending && setStatus.variables?.id === v.id}
                        onClick={() => setStatus.mutate({ id: v.id, status: active ? 'SUSPENDED' : 'ACTIVE' })}
                      >
                        {active ? 'Suspendre' : 'Réactiver'}
                      </Button>
                      <Button variant="ghost" onClick={() => setResetFor(v)}>Mot de passe</Button>
                      <Button
                        variant="danger"
                        loading={remove.isPending && remove.variables === v.id}
                        onClick={() => {
                          if (window.confirm(`Supprimer ${v.email} ?`)) remove.mutate(v.id);
                        }}
                      >
                        Supprimer
                      </Button>
                    </div>
                  </Td>
                </Tr>
              );
            })}
          </tbody>
        </Table>
      )}

      {creating && (
        <CreateModal
          routers={routerList}
          onClose={() => setCreating(false)}
          onDone={() => {
            setCreating(false);
            invalidate();
          }}
        />
      )}
      {resetFor && <ResetModal verifier={resetFor} onClose={() => setResetFor(null)} />}
    </div>
  );
}

function CreateModal({
  routers,
  onClose,
  onDone,
}: {
  routers: RouterSummary[];
  onClose: () => void;
  onDone: () => void;
}) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [routerId, setRouterId] = useState('');

  const mut = useMutation({
    mutationFn: () => {
      const body: CreateVerifierInput = {
        email: email.trim(),
        password,
        ...(name.trim() ? { name: name.trim() } : {}),
        ...(routerId ? { routerId } : {}),
      };
      return apiPost<VerifierItem>('/ticket-verifiers', body);
    },
    onSuccess: onDone,
  });

  return (
    <Modal open title="Nouveau vérificateur" onClose={onClose}>
      <div className="space-y-4">
        <Input label="Email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
        <Input label="Mot de passe" type="password" value={password} onChange={(e) => setPassword(e.target.value)} />
        <Input label="Nom (optionnel)" value={name} onChange={(e) => setName(e.target.value)} />
        <Select label="Routeur assigné (optionnel)" value={routerId} onChange={(e) => setRouterId(e.target.value)}>
          <option value="">— Aucun —</option>
          {routers.map((r) => (
            <option key={r.id} value={r.id}>{r.alias || r.identity}</option>
          ))}
        </Select>
        {mut.error && <ErrorBox message={extractErrorMessage(mut.error)} />}
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>Annuler</Button>
          <Button
            loading={mut.isPending}
            disabled={email.trim().length === 0 || password.length === 0}
            onClick={() => mut.mutate()}
          >
            Créer
          </Button>
        </div>
      </div>
    </Modal>
  );
}

function ResetModal({ verifier, onClose }: { verifier: VerifierItem; onClose: () => void }) {
  const [newPassword, setNewPassword] = useState('');
  const mut = useMutation({
    mutationFn: () => apiPost(`/ticket-verifiers/${verifier.id}/reset-password`, { newPassword }),
  });

  return (
    <Modal open title={`Réinitialiser · ${verifier.email}`} onClose={onClose}>
      <div className="space-y-4">
        <Input label="Nouveau mot de passe" type="password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} />
        {mut.error && <ErrorBox message={extractErrorMessage(mut.error)} />}
        {mut.isSuccess && <div className="text-sm text-success">Mot de passe réinitialisé.</div>}
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>Fermer</Button>
          <Button loading={mut.isPending} disabled={newPassword.length === 0} onClick={() => mut.mutate()}>
            Réinitialiser
          </Button>
        </div>
      </div>
    </Modal>
  );
}

export default function AdminVerificateursPage() {
  return (
    <AdminGuard roles={['ADMIN', 'SUPER_ADMIN']}>
      <VerificateursInner />
    </AdminGuard>
  );
}
