'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiDelete, apiGet, apiPatch, apiPost, extractErrorMessage } from '@/lib/api';
import { Badge, Button, Card, ErrorBox, Input } from '@/components/ui';
import type { RemoteStatus, RouterItem, TicketTemplate } from '@/components/routeurs/shared';

type Credentials = { username: string; password: string; host: string | null } | null;

function Toggle({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <label className="flex cursor-pointer items-center justify-between py-1.5">
      <span className="text-sm text-fg">{label}</span>
      <button
        type="button"
        onClick={() => onChange(!checked)}
        className={`relative h-6 w-11 rounded-full transition ${checked ? 'bg-primary' : 'bg-surface2'}`}
      >
        <span
          className={`absolute top-0.5 h-5 w-5 rounded-full bg-white transition-all ${
            checked ? 'left-[22px]' : 'left-0.5'
          }`}
        />
      </button>
    </label>
  );
}

const DEFAULT_TEMPLATE: TicketTemplate = {
  showCompanyName: true,
  companyName: '',
  showWifiName: true,
  wifiName: '',
  showPrice: true,
  showDuration: true,
  showQrCode: true,
  showPlanName: true,
  showTicketNumber: true,
  showCreatedAt: false,
  showPoweredBy: true,
  showNote: false,
  note: '',
  currency: 'FCFA',
};

export default function RouterParametresPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const qc = useQueryClient();

  const routerQuery = useQuery({
    queryKey: ['router', id],
    queryFn: () => apiGet<RouterItem>(`/routers/${id}`),
    enabled: Boolean(id),
  });
  const remote = useQuery({
    queryKey: ['router', id, 'remote'],
    queryFn: () => apiGet<RemoteStatus>(`/routers/${id}/remote`),
    enabled: Boolean(id),
    retry: false,
  });
  const credentials = useQuery({
    queryKey: ['router', id, 'credentials'],
    queryFn: () => apiGet<Credentials>(`/routers/${id}/credentials`),
    enabled: Boolean(id),
    retry: false,
  });

  // ── Général ──
  const [alias, setAlias] = useState('');
  const [model, setModel] = useState('');
  const [localAddress, setLocalAddress] = useState('');
  const [push, setPush] = useState(true);
  // ── Identifiants ──
  const [username, setUsername] = useState('admin');
  const [password, setPassword] = useState('');
  // ── Template ──
  const [template, setTemplate] = useState<TicketTemplate>(DEFAULT_TEMPLATE);
  const [confirmDelete, setConfirmDelete] = useState(false);

  useEffect(() => {
    if (routerQuery.data) {
      setAlias(routerQuery.data.alias ?? '');
      setModel(routerQuery.data.model ?? '');
      setLocalAddress(routerQuery.data.localAddress ?? '');
      setPush(routerQuery.data.pushNotifications);
      setTemplate({ ...DEFAULT_TEMPLATE, ...(routerQuery.data.ticketTemplate ?? {}) });
    }
  }, [routerQuery.data]);
  useEffect(() => {
    if (credentials.data) setUsername(credentials.data.username || 'admin');
  }, [credentials.data]);

  const saveGeneral = useMutation({
    mutationFn: () =>
      apiPatch<RouterItem>(`/routers/${id}`, {
        alias: alias.trim() || null,
        model: model.trim() || null,
        localAddress: localAddress.trim() || null,
        pushNotifications: push,
      }),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ['router', id] });
      await qc.invalidateQueries({ queryKey: ['routers'] });
    },
  });

  const saveCredentials = useMutation({
    mutationFn: () =>
      apiPatch<RouterItem>(`/routers/${id}`, {
        credentials: { username, password },
        ...(localAddress.trim() ? { localAddress: localAddress.trim() } : {}),
      }),
    onSuccess: async () => {
      setPassword('');
      await qc.invalidateQueries({ queryKey: ['router', id, 'credentials'] });
      await qc.invalidateQueries({ queryKey: ['router', id] });
    },
  });

  const saveTemplate = useMutation({
    mutationFn: () => apiPatch<RouterItem>(`/routers/${id}/ticket-template`, template),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['router', id] }),
  });

  const activate = useMutation({
    mutationFn: () => apiPost<{ activated: boolean }>(`/routers/${id}/remote/activate`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['router', id, 'remote'] }),
  });
  const revoke = useMutation({
    mutationFn: () => apiPost<{ revoked: boolean }>(`/routers/${id}/remote/revoke`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['router', id, 'remote'] }),
  });

  const removeRouter = useMutation({
    mutationFn: () => apiDelete<{ deleted: boolean }>(`/routers/${id}`),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ['routers'] });
      router.replace('/routeurs');
    },
  });

  function tset<K extends keyof TicketTemplate>(key: K, value: TicketTemplate[K]) {
    setTemplate((t) => ({ ...t, [key]: value }));
  }

  const remoteActive = remote.data?.status === 'ACTIVE';

  return (
    <div className="space-y-6">
      {/* Général */}
      <Card className="space-y-4">
        <h2 className="text-lg font-semibold">Général</h2>
        {saveGeneral.error ? <ErrorBox message={extractErrorMessage(saveGeneral.error)} /> : null}
        <Input label="Alias" value={alias} onChange={(e) => setAlias(e.target.value)} />
        <Input label="Modèle" value={model} onChange={(e) => setModel(e.target.value)} />
        <Input
          label="Adresse locale"
          placeholder="192.168.88.1:8728"
          value={localAddress}
          onChange={(e) => setLocalAddress(e.target.value)}
          autoCapitalize="none"
        />
        <Toggle label="Notifications push" checked={push} onChange={setPush} />
        <Button onClick={() => saveGeneral.mutate()} loading={saveGeneral.isPending}>
          Enregistrer
        </Button>
      </Card>

      {/* Identifiants */}
      <Card className="space-y-4">
        <h2 className="text-lg font-semibold">Identifiants RouterOS</h2>
        {saveCredentials.error ? (
          <ErrorBox message={extractErrorMessage(saveCredentials.error)} />
        ) : null}
        <Input
          label="Utilisateur"
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          autoCapitalize="none"
        />
        <Input
          label="Mot de passe"
          type="password"
          placeholder={credentials.data ? '•••••• (inchangé si vide)' : ''}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
        <p className="text-xs text-muted">
          Chiffrés côté serveur. Utilisés pour la gestion distante et la synchronisation.
        </p>
        <Button
          onClick={() => saveCredentials.mutate()}
          loading={saveCredentials.isPending}
          disabled={!username.trim() || !password}
        >
          Mettre à jour les identifiants
        </Button>
      </Card>

      {/* Modèle de ticket */}
      <Card className="space-y-3">
        <h2 className="text-lg font-semibold">Modèle de ticket</h2>
        {saveTemplate.error ? <ErrorBox message={extractErrorMessage(saveTemplate.error)} /> : null}
        <Input
          label="Nom de l'entreprise"
          value={template.companyName ?? ''}
          onChange={(e) => tset('companyName', e.target.value)}
        />
        <Input
          label="Nom du Wi-Fi"
          value={template.wifiName ?? ''}
          onChange={(e) => tset('wifiName', e.target.value)}
        />
        <div className="divide-y divide-border">
          <Toggle label="Afficher le nom de l'entreprise" checked={template.showCompanyName} onChange={(v) => tset('showCompanyName', v)} />
          <Toggle label="Afficher le nom du Wi-Fi" checked={template.showWifiName} onChange={(v) => tset('showWifiName', v)} />
          <Toggle label="Afficher le prix" checked={template.showPrice} onChange={(v) => tset('showPrice', v)} />
          <Toggle label="Afficher la durée" checked={template.showDuration ?? false} onChange={(v) => tset('showDuration', v)} />
          <Toggle label="Afficher le QR code" checked={template.showQrCode} onChange={(v) => tset('showQrCode', v)} />
          <Toggle label="Afficher le nom du forfait" checked={template.showPlanName} onChange={(v) => tset('showPlanName', v)} />
          <Toggle label="Afficher le numéro de ticket" checked={template.showTicketNumber} onChange={(v) => tset('showTicketNumber', v)} />
          <Toggle label="Afficher « Propulsé par »" checked={template.showPoweredBy} onChange={(v) => tset('showPoweredBy', v)} />
        </div>
        <Button onClick={() => saveTemplate.mutate()} loading={saveTemplate.isPending}>
          Enregistrer le modèle
        </Button>
      </Card>

      {/* Accès distant */}
      <Card className="space-y-4">
        <h2 className="text-lg font-semibold">Accès distant</h2>
        <div className="flex items-center gap-2">
          <Badge tone={remoteActive ? 'success' : 'muted'}>
            {remoteActive ? 'Actif' : remote.data?.status ?? 'Indisponible'}
          </Badge>
          {remote.data?.endpoint && <span className="text-xs text-muted">{remote.data.endpoint}</span>}
        </div>
        {(activate.error || revoke.error) && (
          <ErrorBox message={extractErrorMessage(activate.error || revoke.error)} />
        )}
        <div className="flex gap-2">
          <Button onClick={() => activate.mutate()} loading={activate.isPending} disabled={remoteActive}>
            Activer
          </Button>
          <Button
            variant="danger"
            onClick={() => revoke.mutate()}
            loading={revoke.isPending}
            disabled={!remoteActive}
          >
            Révoquer
          </Button>
        </div>
      </Card>

      {/* Zone danger */}
      <Card className="space-y-3 border-danger/40">
        <h2 className="text-lg font-semibold text-danger">Supprimer le routeur</h2>
        {removeRouter.error ? <ErrorBox message={extractErrorMessage(removeRouter.error)} /> : null}
        {confirmDelete ? (
          <div className="flex gap-2">
            <Button variant="danger" onClick={() => removeRouter.mutate()} loading={removeRouter.isPending}>
              Confirmer la suppression
            </Button>
            <Button variant="ghost" onClick={() => setConfirmDelete(false)}>
              Annuler
            </Button>
          </div>
        ) : (
          <Button variant="danger" onClick={() => setConfirmDelete(true)}>
            Supprimer ce routeur
          </Button>
        )}
      </Card>
    </div>
  );
}
