'use client';

import { useMemo, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { apiPost, extractErrorMessage } from '@/lib/api';
import { Button, ErrorBox } from '@/components/ui';
import { xof } from '@/lib/format';
import { Modal } from './Modal';
import {
  durationLabel,
  MAX_QUANTITY,
  type GenerateResult,
  type PlanFull,
  type VoucherItem,
} from './types';

export function GenerateDialog({
  routerId,
  plans,
  onClose,
  onGenerated,
}: {
  routerId: string;
  plans: PlanFull[];
  onClose: () => void;
  onGenerated: () => void;
}) {
  const [planId, setPlanId] = useState<string | null>(plans[0]?.id ?? null);
  const [quantity, setQuantity] = useState(1);
  const [result, setResult] = useState<GenerateResult | null>(null);

  const selectedPlan = plans.find((p) => p.id === planId) ?? null;
  const totalValue = (selectedPlan?.priceXof ?? 0) * quantity;

  const mutation = useMutation({
    mutationFn: () =>
      apiPost<GenerateResult>(`/routers/${routerId}/vouchers/generate`, {
        planId,
        quantity,
      }),
    onSuccess: (data) => {
      setResult(data);
      onGenerated();
    },
  });

  const usable = useMemo<VoucherItem[]>(
    () => (result ? result.vouchers.filter((v) => v.provisioned) : []),
    [result],
  );

  function copyCodes() {
    const text = usable.map((v) => v.code).join('\n');
    void navigator.clipboard?.writeText(text);
  }

  const quantityValid = quantity >= 1 && quantity <= MAX_QUANTITY;

  return (
    <Modal title="Générer des tickets" onClose={onClose}>
      {result ? (
        <div className="space-y-4">
          {result.pushedByServer ? (
            <div className="rounded-xl border border-success/40 bg-success/10 px-4 py-3 text-sm text-success">
              Lot #{result.batchSeq} : {usable.length} ticket(s) disponible(s) sur{' '}
              {result.totalCount}.
            </div>
          ) : (
            <div className="rounded-xl border border-warning/40 bg-warning/10 px-4 py-3 text-sm text-warning">
              Lot #{result.batchSeq} créé, mais ce routeur est en mode LOCAL : les
              tickets doivent être poussés depuis l&apos;application mobile connectée
              au réseau du routeur pour devenir distribuables.
            </div>
          )}

          {usable.length > 0 && (
            <div className="max-h-56 overflow-y-auto rounded-xl border border-border bg-surface2 p-3">
              <div className="grid grid-cols-2 gap-2 font-mono text-sm text-fg sm:grid-cols-3">
                {usable.map((v) => (
                  <span key={v.id}>{v.code}</span>
                ))}
              </div>
            </div>
          )}

          <div className="flex justify-end gap-2">
            {usable.length > 0 && (
              <Button variant="ghost" onClick={copyCodes}>
                Copier les codes
              </Button>
            )}
            <Button onClick={onClose}>Fermer</Button>
          </div>
        </div>
      ) : (
        <div className="space-y-4">
          <div>
            <span className="mb-1.5 block text-sm text-muted">Forfait</span>
            <div className="space-y-2">
              {plans.map((p) => {
                const active = p.id === planId;
                return (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => setPlanId(p.id)}
                    className={`flex w-full items-center justify-between rounded-xl border px-3.5 py-2.5 text-left transition ${
                      active ? 'border-primary bg-surface2' : 'border-border hover:bg-surface2'
                    }`}
                  >
                    <span className="text-fg">{p.name}</span>
                    <span className="text-xs text-success">
                      {xof(p.priceXof)} · {durationLabel(p.durationMinutes)}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>

          <label className="block">
            <span className="mb-1.5 block text-sm text-muted">
              Quantité (max {MAX_QUANTITY})
            </span>
            <input
              type="number"
              min={1}
              max={MAX_QUANTITY}
              value={quantity}
              onChange={(e) => {
                const n = Number.parseInt(e.target.value, 10);
                setQuantity(Number.isNaN(n) ? 0 : Math.min(MAX_QUANTITY, Math.max(0, n)));
              }}
              className="w-full rounded-xl border border-border bg-surface2 px-3.5 py-2.5 text-fg outline-none focus:border-primary"
            />
          </label>

          {selectedPlan && (
            <div className="rounded-xl border border-border bg-surface2 px-4 py-3 text-sm">
              <div className="flex justify-between text-muted">
                <span>Valeur totale</span>
                <span className="font-bold text-success">{xof(totalValue)}</span>
              </div>
            </div>
          )}

          {mutation.error && <ErrorBox message={extractErrorMessage(mutation.error)} />}

          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={onClose}>
              Annuler
            </Button>
            <Button
              loading={mutation.isPending}
              disabled={!planId || !quantityValid}
              onClick={() => mutation.mutate()}
            >
              Générer {quantity > 0 ? `(${quantity})` : ''}
            </Button>
          </div>
        </div>
      )}
    </Modal>
  );
}
