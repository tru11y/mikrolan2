'use client';

import { Badge, Card } from '@/components/ui';
import { dateFr } from '@/lib/format';
import type { MeDetail } from './types';

const ROLE_LABELS: Record<string, string> = {
  SUPER_ADMIN: 'Super administrateur',
  ADMIN: 'Administrateur',
  MEMBER: 'Membre',
  TICKET_VERIFIER: 'Vérificateur',
};

export function ProfileSection({ me }: { me: MeDetail }) {
  const plan = me.subscription?.plan ?? 'FREE';
  return (
    <Card>
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="text-lg font-semibold text-fg">{me.user.name || me.user.email}</div>
          <div className="text-sm text-muted">{me.user.email}</div>
        </div>
        <Badge tone={plan === 'PRO' ? 'primary' : 'muted'}>{plan}</Badge>
      </div>

      <dl className="mt-5 grid grid-cols-1 gap-3 text-sm sm:grid-cols-2">
        <Field label="Organisation" value={me.tenant.name} />
        <Field label="Rôle" value={ROLE_LABELS[me.user.role] ?? me.user.role} />
        <Field label="Pays" value={me.user.country || '—'} />
        <Field
          label="Abonnement"
          value={
            me.subscription
              ? `${me.subscription.status}${
                  me.subscription.currentPeriodEnd
                    ? ` · jusqu'au ${dateFr(me.subscription.currentPeriodEnd)}`
                    : ''
                }`
              : 'Gratuit'
          }
        />
      </dl>
    </Card>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-border bg-surface2 px-3.5 py-2.5">
      <dt className="text-xs text-muted">{label}</dt>
      <dd className="mt-0.5 font-medium text-fg">{value}</dd>
    </div>
  );
}
