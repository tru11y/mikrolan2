'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { apiPost, extractErrorMessage } from '@/lib/api';
import type { ManagementMode } from '@/lib/types';
import { Button, Card, ErrorBox, Input, PageHeader } from '@/components/ui';
import { Select, type RouterItem } from '@/components/routeurs/shared';

type CreateRouterPayload = {
  identity: string;
  alias?: string;
  model?: string;
  localAddress?: string;
  mode: ManagementMode;
  credentials?: { username: string; password: string };
};

export default function AjouterRouteurPage() {
  const router = useRouter();
  const qc = useQueryClient();

  const [identity, setIdentity] = useState('');
  const [alias, setAlias] = useState('');
  const [model, setModel] = useState('');
  const [mode, setMode] = useState<ManagementMode>('LOCAL');
  const [address, setAddress] = useState('');
  const [port, setPort] = useState('8728');
  const [username, setUsername] = useState('admin');
  const [password, setPassword] = useState('');

  const create = useMutation({
    mutationFn: () => {
      const trimmedAddr = address.trim();
      const portNum = Number.parseInt(port, 10) || 8728;
      const payload: CreateRouterPayload = {
        identity: identity.trim(),
        mode,
        ...(alias.trim() ? { alias: alias.trim() } : {}),
        ...(model.trim() ? { model: model.trim() } : {}),
        ...(trimmedAddr ? { localAddress: `${trimmedAddr}:${portNum}` } : {}),
        ...(trimmedAddr && password ? { credentials: { username, password } } : {}),
      };
      return apiPost<RouterItem>('/routers', payload);
    },
    onSuccess: async (created) => {
      await qc.invalidateQueries({ queryKey: ['routers'] });
      router.replace(`/routeurs/${created.id}`);
    },
  });

  const canSave = identity.trim().length >= 2 && !create.isPending;

  return (
    <div>
      <PageHeader title="Ajouter un routeur" />

      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          if (canSave) create.mutate();
        }}
      >
        {create.error ? <ErrorBox message={extractErrorMessage(create.error)} /> : null}

        <Card className="space-y-4">
          <Input
            label="Identité (nom RouterOS)"
            placeholder="MikroTik"
            value={identity}
            onChange={(e) => setIdentity(e.target.value)}
            autoCapitalize="characters"
          />
          <Input
            label="Alias (facultatif)"
            placeholder="Boutique centre-ville"
            value={alias}
            onChange={(e) => setAlias(e.target.value)}
          />
          <Input
            label="Modèle (facultatif)"
            placeholder="hAP ac²"
            value={model}
            onChange={(e) => setModel(e.target.value)}
          />
          <Select label="Mode de gestion" value={mode} onChange={(v) => setMode(v as ManagementMode)}>
            <option value="LOCAL">Local (LAN)</option>
            <option value="REMOTE">Distant (tunnel)</option>
          </Select>
        </Card>

        <Card className="space-y-4">
          <div className="text-sm font-semibold text-fg">Connexion RouterOS (facultatif)</div>
          <div className="grid grid-cols-[1fr_120px] gap-3">
            <Input
              label="Adresse"
              placeholder="192.168.88.1"
              value={address}
              onChange={(e) => setAddress(e.target.value)}
              autoCapitalize="none"
            />
            <Input
              label="Port API"
              placeholder="8728"
              inputMode="numeric"
              value={port}
              onChange={(e) => setPort(e.target.value.replace(/[^0-9]/g, ''))}
            />
          </div>
          <Input
            label="Utilisateur"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            autoCapitalize="none"
          />
          <Input
            label="Mot de passe"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
          <p className="text-xs text-muted">
            Les identifiants sont chiffrés côté serveur. Ils permettent la gestion distante et la
            synchronisation des sessions.
          </p>
        </Card>

        <div className="flex gap-3">
          <Button type="submit" loading={create.isPending} disabled={!canSave}>
            Enregistrer le routeur
          </Button>
          <Link href="/routeurs">
            <Button type="button" variant="ghost">
              Annuler
            </Button>
          </Link>
        </div>
      </form>
    </div>
  );
}
