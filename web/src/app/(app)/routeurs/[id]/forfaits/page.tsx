'use client';

import { useState } from 'react';
import { useParams } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiDelete, apiGet, apiPatch, apiPost, extractErrorMessage } from '@/lib/api';
import { xof } from '@/lib/format';
import { Badge, Button, Card, EmptyState, ErrorBox, Input, Loading } from '@/components/ui';
import {
  fmtDuration,
  Select,
  type CreatePlanPayload,
  type PlanCodeFormat,
  type PlanExpiration,
  type RouterPlan,
} from '@/components/routeurs/shared';

type FormState = {
  name: string;
  price: string;
  sharedUsers: string;
  days: string;
  hours: string;
  minutes: string;
  downMbps: string;
  upMbps: string;
  expirationMode: PlanExpiration;
  codePrefix: string;
  codeLength: string;
  codeFormat: PlanCodeFormat;
};

const EMPTY: FormState = {
  name: '',
  price: '',
  sharedUsers: '1',
  days: '0',
  hours: '1',
  minutes: '0',
  downMbps: '',
  upMbps: '',
  expirationMode: 'ELAPSED',
  codePrefix: '',
  codeLength: '8',
  codeFormat: 'ALPHANUMERIC',
};

function toPayload(f: FormState): CreatePlanPayload {
  const durationMinutes =
    (Number.parseInt(f.days, 10) || 0) * 1440 +
    (Number.parseInt(f.hours, 10) || 0) * 60 +
    (Number.parseInt(f.minutes, 10) || 0);
  return {
    name: f.name.trim(),
    durationMinutes,
    priceXof: Number.parseInt(f.price, 10) || 0,
    sharedUsers: Number.parseInt(f.sharedUsers, 10) || 1,
    downloadKbps: f.downMbps ? Number.parseInt(f.downMbps, 10) * 1000 : null,
    uploadKbps: f.upMbps ? Number.parseInt(f.upMbps, 10) * 1000 : null,
    expirationMode: f.expirationMode,
    codePrefix: f.codePrefix.trim() || null,
    codeLength: Number.parseInt(f.codeLength, 10) || 8,
    codeFormat: f.codeFormat,
  };
}

function fromPlan(p: RouterPlan): FormState {
  return {
    name: p.name,
    price: String(p.priceXof),
    sharedUsers: String(p.sharedUsers),
    days: String(Math.floor(p.durationMinutes / 1440)),
    hours: String(Math.floor((p.durationMinutes % 1440) / 60)),
    minutes: String(p.durationMinutes % 60),
    downMbps: p.downloadKbps ? String(Math.round(p.downloadKbps / 1000)) : '',
    upMbps: p.uploadKbps ? String(Math.round(p.uploadKbps / 1000)) : '',
    expirationMode: p.expirationMode,
    codePrefix: p.codePrefix ?? '',
    codeLength: String(p.codeLength),
    codeFormat: p.codeFormat,
  };
}

export default function RouterForfaitsPage() {
  const { id } = useParams<{ id: string }>();
  const qc = useQueryClient();

  const [editingId, setEditingId] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState<FormState>(EMPTY);

  const plans = useQuery({
    queryKey: ['plans', id],
    queryFn: () => apiGet<RouterPlan[]>(`/routers/${id}/plans`),
    enabled: Boolean(id),
  });

  const upsert = useMutation({
    mutationFn: () => {
      const payload = toPayload(form);
      return editingId
        ? apiPatch<RouterPlan>(`/routers/${id}/plans/${editingId}`, payload)
        : apiPost<RouterPlan>(`/routers/${id}/plans`, payload);
    },
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ['plans', id] });
      closeForm();
    },
  });

  const remove = useMutation({
    mutationFn: (planId: string) => apiDelete<{ deleted: boolean }>(`/routers/${id}/plans/${planId}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['plans', id] }),
  });

  function set<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((f) => ({ ...f, [key]: value }));
  }
  function openCreate() {
    setEditingId(null);
    setForm(EMPTY);
    setShowForm(true);
  }
  function openEdit(p: RouterPlan) {
    setEditingId(p.id);
    setForm(fromPlan(p));
    setShowForm(true);
  }
  function closeForm() {
    setShowForm(false);
    setEditingId(null);
    setForm(EMPTY);
  }

  const durationMinutes =
    (Number.parseInt(form.days, 10) || 0) * 1440 +
    (Number.parseInt(form.hours, 10) || 0) * 60 +
    (Number.parseInt(form.minutes, 10) || 0);
  const valid = form.name.trim().length >= 2 && form.price !== '' && durationMinutes > 0;

  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-lg font-semibold">Forfaits</h2>
        <Button onClick={showForm ? closeForm : openCreate} variant={showForm ? 'ghost' : 'primary'}>
          {showForm ? 'Fermer' : 'Nouveau forfait'}
        </Button>
      </div>

      {showForm && (
        <Card className="mb-5 space-y-4">
          {upsert.error ? <ErrorBox message={extractErrorMessage(upsert.error)} /> : null}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-[2fr_1fr]">
            <Input label="Nom" value={form.name} onChange={(e) => set('name', e.target.value)} />
            <Input
              label="Prix (FCFA)"
              inputMode="numeric"
              value={form.price}
              onChange={(e) => set('price', e.target.value.replace(/[^0-9]/g, ''))}
            />
          </div>

          <div>
            <span className="mb-1.5 block text-sm text-muted">Validité</span>
            <div className="grid grid-cols-3 gap-3">
              <Input
                label="Jours"
                inputMode="numeric"
                value={form.days}
                onChange={(e) => set('days', e.target.value.replace(/[^0-9]/g, ''))}
              />
              <Input
                label="Heures"
                inputMode="numeric"
                value={form.hours}
                onChange={(e) => set('hours', e.target.value.replace(/[^0-9]/g, ''))}
              />
              <Input
                label="Minutes"
                inputMode="numeric"
                value={form.minutes}
                onChange={(e) => set('minutes', e.target.value.replace(/[^0-9]/g, ''))}
              />
            </div>
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <Input
              label="Appareils simultanés"
              inputMode="numeric"
              value={form.sharedUsers}
              onChange={(e) => set('sharedUsers', e.target.value.replace(/[^0-9]/g, ''))}
            />
            <Input
              label="Download (Mbps)"
              placeholder="Illimité"
              inputMode="numeric"
              value={form.downMbps}
              onChange={(e) => set('downMbps', e.target.value.replace(/[^0-9]/g, ''))}
            />
            <Input
              label="Upload (Mbps)"
              placeholder="Illimité"
              inputMode="numeric"
              value={form.upMbps}
              onChange={(e) => set('upMbps', e.target.value.replace(/[^0-9]/g, ''))}
            />
          </div>

          <Select
            label="Expiration"
            value={form.expirationMode}
            onChange={(v) => set('expirationMode', v as PlanExpiration)}
          >
            <option value="ELAPSED">Temps écoulé</option>
            <option value="RADIO_PAUSE">Pause à la déconnexion</option>
          </Select>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <Input
              label="Préfixe code"
              value={form.codePrefix}
              onChange={(e) => set('codePrefix', e.target.value.replace(/[^A-Za-z0-9]/g, ''))}
            />
            <Input
              label="Longueur code"
              inputMode="numeric"
              value={form.codeLength}
              onChange={(e) => set('codeLength', e.target.value.replace(/[^0-9]/g, ''))}
            />
            <Select
              label="Format"
              value={form.codeFormat}
              onChange={(v) => set('codeFormat', v as PlanCodeFormat)}
            >
              <option value="ALPHANUMERIC">Alphanumérique</option>
              <option value="NUMERIC">Numérique</option>
            </Select>
          </div>

          <div className="flex gap-3">
            <Button onClick={() => upsert.mutate()} loading={upsert.isPending} disabled={!valid}>
              {editingId ? 'Enregistrer' : 'Créer le forfait'}
            </Button>
            <Button variant="ghost" onClick={closeForm}>
              Annuler
            </Button>
          </div>
        </Card>
      )}

      {remove.error ? (
        <div className="mb-4">
          <ErrorBox message={extractErrorMessage(remove.error)} />
        </div>
      ) : null}

      {plans.isLoading ? (
        <Loading />
      ) : plans.error ? (
        <ErrorBox message={extractErrorMessage(plans.error)} />
      ) : (plans.data ?? []).length === 0 ? (
        <EmptyState>Aucun forfait pour ce routeur.</EmptyState>
      ) : (
        <div className="space-y-2">
          {plans.data!.map((p) => (
            <Card key={p.id} className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <span className="font-medium text-fg">{p.name}</span>
                  {p.status === 'ARCHIVED' && <Badge tone="muted">Archivé</Badge>}
                </div>
                <div className="mt-0.5 text-xs text-muted">
                  {xof(p.priceXof)} · {fmtDuration(p.durationMinutes)} · {p.sharedUsers} appareil(s)
                </div>
              </div>
              <div className="flex shrink-0 gap-2">
                <Button variant="ghost" onClick={() => openEdit(p)}>
                  Éditer
                </Button>
                <Button
                  variant="danger"
                  onClick={() => remove.mutate(p.id)}
                  loading={remove.isPending && remove.variables === p.id}
                >
                  Supprimer
                </Button>
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
