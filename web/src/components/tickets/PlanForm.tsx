'use client';

import { useMemo, useState } from 'react';
import { Button, ErrorBox, Input } from '@/components/ui';
import { Modal } from './Modal';
import {
  CODE_LENGTH_MAX,
  CODE_LENGTH_MIN,
  type CreatePlanPayload,
  type PlanCodeFormat,
  type PlanExpiration,
  type PlanFull,
} from './types';

function num(v: string): number {
  const n = Number.parseInt(v, 10);
  return Number.isNaN(n) ? 0 : n;
}

export function PlanForm({
  initial,
  busy,
  errorMessage,
  onSubmit,
  onClose,
}: {
  initial: PlanFull | null;
  busy: boolean;
  errorMessage: string | null;
  onSubmit: (payload: CreatePlanPayload) => void;
  onClose: () => void;
}) {
  const [name, setName] = useState(initial?.name ?? '');
  const [price, setPrice] = useState(initial ? String(initial.priceXof) : '');
  const [sharedUsers, setSharedUsers] = useState(initial ? String(initial.sharedUsers) : '1');
  const [days, setDays] = useState(initial ? String(Math.floor(initial.durationMinutes / 1440)) : '0');
  const [hours, setHours] = useState(
    initial ? String(Math.floor((initial.durationMinutes % 1440) / 60)) : '1',
  );
  const [minutes, setMinutes] = useState(initial ? String(initial.durationMinutes % 60) : '0');
  const [downMbps, setDownMbps] = useState(
    initial?.downloadKbps ? String(Math.round(initial.downloadKbps / 1000)) : '',
  );
  const [upMbps, setUpMbps] = useState(
    initial?.uploadKbps ? String(Math.round(initial.uploadKbps / 1000)) : '',
  );
  const [dataLimitMb, setDataLimitMb] = useState(
    initial?.dataLimitMb ? String(initial.dataLimitMb) : '',
  );
  const [expirationMode, setExpirationMode] = useState<PlanExpiration>(
    initial?.expirationMode ?? 'ELAPSED',
  );
  const [codePrefix, setCodePrefix] = useState(initial?.codePrefix ?? '');
  const [codeLength, setCodeLength] = useState(initial ? String(initial.codeLength) : '8');
  const [codeFormat, setCodeFormat] = useState<PlanCodeFormat>(initial?.codeFormat ?? 'ALPHANUMERIC');
  const [submitted, setSubmitted] = useState(false);

  const durationMinutes = num(days) * 1440 + num(hours) * 60 + num(minutes);

  const errors = useMemo(() => {
    const e: Record<string, string> = {};
    if (name.trim().length < 2) e.name = 'Nom requis (2 caractères min).';
    if (price === '' || num(price) < 0) e.price = 'Prix requis.';
    if (durationMinutes <= 0) e.duration = 'Durée requise.';
    if (num(sharedUsers) < 1) e.sharedUsers = 'Au moins 1 appareil.';
    const len = num(codeLength);
    if (len < CODE_LENGTH_MIN || len > CODE_LENGTH_MAX)
      e.codeLength = `Entre ${CODE_LENGTH_MIN} et ${CODE_LENGTH_MAX}.`;
    return e;
  }, [name, price, durationMinutes, sharedUsers, codeLength]);

  const valid = Object.keys(errors).length === 0;
  const show = (k: string): string | undefined => (submitted ? errors[k] : undefined);

  function submit() {
    setSubmitted(true);
    if (!valid) return;
    onSubmit({
      name: name.trim(),
      durationMinutes,
      priceXof: num(price),
      sharedUsers: num(sharedUsers),
      downloadKbps: downMbps ? num(downMbps) * 1000 : null,
      uploadKbps: upMbps ? num(upMbps) * 1000 : null,
      dataLimitMb: dataLimitMb ? num(dataLimitMb) : null,
      expirationMode,
      codePrefix: codePrefix.trim() || null,
      codeLength: num(codeLength),
      codeFormat,
    });
  }

  return (
    <Modal title={initial ? 'Modifier le forfait' : 'Nouveau forfait'} onClose={onClose} width="max-w-xl">
      <div className="space-y-4">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <div className="sm:col-span-2">
            <Input label="Nom" value={name} onChange={(e) => setName(e.target.value)} maxLength={100} />
            {show('name') && <p className="mt-1 text-xs text-danger">{show('name')}</p>}
          </div>
          <div>
            <Input
              label="Prix (FCFA)"
              type="number"
              min={0}
              value={price}
              onChange={(e) => setPrice(e.target.value)}
            />
            {show('price') && <p className="mt-1 text-xs text-danger">{show('price')}</p>}
          </div>
        </div>

        <div>
          <span className="mb-1.5 block text-sm text-muted">Durée de validité</span>
          <div className="grid grid-cols-3 gap-3">
            <Input label="Jours" type="number" min={0} value={days} onChange={(e) => setDays(e.target.value)} />
            <Input label="Heures" type="number" min={0} max={23} value={hours} onChange={(e) => setHours(e.target.value)} />
            <Input label="Minutes" type="number" min={0} max={59} value={minutes} onChange={(e) => setMinutes(e.target.value)} />
          </div>
          {show('duration') && <p className="mt-1 text-xs text-danger">{show('duration')}</p>}
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <div>
            <Input
              label="Appareils simultanés"
              type="number"
              min={1}
              value={sharedUsers}
              onChange={(e) => setSharedUsers(e.target.value)}
            />
            {show('sharedUsers') && <p className="mt-1 text-xs text-danger">{show('sharedUsers')}</p>}
          </div>
          <Input
            label="Débit ↓ (Mbps)"
            type="number"
            min={1}
            placeholder="Illimité"
            value={downMbps}
            onChange={(e) => setDownMbps(e.target.value)}
          />
          <Input
            label="Débit ↑ (Mbps)"
            type="number"
            min={1}
            placeholder="Illimité"
            value={upMbps}
            onChange={(e) => setUpMbps(e.target.value)}
          />
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Input
            label="Quota de données (Mo)"
            type="number"
            min={1}
            placeholder="Illimité"
            value={dataLimitMb}
            onChange={(e) => setDataLimitMb(e.target.value)}
          />
          <label className="block">
            <span className="mb-1.5 block text-sm text-muted">Expiration</span>
            <select
              value={expirationMode}
              onChange={(e) => setExpirationMode(e.target.value as PlanExpiration)}
              className="w-full rounded-xl border border-border bg-surface2 px-3.5 py-2.5 text-fg outline-none focus:border-primary"
            >
              <option value="ELAPSED">Au temps écoulé</option>
              <option value="RADIO_PAUSE">À la première connexion</option>
            </select>
          </label>
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <Input
            label="Préfixe de code"
            value={codePrefix}
            onChange={(e) => setCodePrefix(e.target.value.replace(/[^A-Za-z0-9]/g, ''))}
            maxLength={12}
            placeholder="(optionnel)"
          />
          <div>
            <Input
              label="Longueur de code"
              type="number"
              min={CODE_LENGTH_MIN}
              max={CODE_LENGTH_MAX}
              value={codeLength}
              onChange={(e) => setCodeLength(e.target.value)}
            />
            {show('codeLength') && <p className="mt-1 text-xs text-danger">{show('codeLength')}</p>}
          </div>
          <label className="block">
            <span className="mb-1.5 block text-sm text-muted">Format</span>
            <select
              value={codeFormat}
              onChange={(e) => setCodeFormat(e.target.value as PlanCodeFormat)}
              className="w-full rounded-xl border border-border bg-surface2 px-3.5 py-2.5 text-fg outline-none focus:border-primary"
            >
              <option value="ALPHANUMERIC">Alphanumérique</option>
              <option value="NUMERIC">Numérique</option>
            </select>
          </label>
        </div>

        {errorMessage && <ErrorBox message={errorMessage} />}

        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>
            Annuler
          </Button>
          <Button loading={busy} onClick={submit}>
            {initial ? 'Enregistrer' : 'Créer'}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
