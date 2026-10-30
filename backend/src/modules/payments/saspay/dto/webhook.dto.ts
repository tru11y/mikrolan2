import { z } from 'zod';

/**
 * Payload d'event webhook SasPay. Volontairement permissif : SasPay peut
 * ajouter des champs à `data`, et les events `settlement.*` ne sont pas
 * stabilisés — on ne valide que ce dont on dépend pour router l'activation.
 */
export const saspayWebhookEventSchema = z.object({
  event: z.string().min(1),
  data: z.record(z.unknown()).default({}),
});

export type SaspayWebhookEvent = z.infer<typeof saspayWebhookEventSchema>;

/** Sous-schéma spécifique pour les events transaction.* qu'on exploite. */
export const saspayTransactionDataSchema = z.object({
  id: z.string().min(1).optional(),
  reference: z.string().min(1).optional(),
  status: z.string().optional(),
  amount: z.union([z.string(), z.number()]).optional(),
  fee: z.union([z.string(), z.number()]).optional(),
  charged: z.union([z.string(), z.number()]).optional(),
  net_amount: z.union([z.string(), z.number()]).optional(),
  fee_charge_mode: z.string().optional(),
  currency: z.string().optional(),
  country: z.string().optional(),
  network: z.string().optional(),
  msisdn: z.string().optional(),
  // Les clés metadata que nous avons envoyées lors de la création de la session.
  metadata: z
    .object({
      intentId: z.string().optional(),
      invoiceId: z.string().optional(),
      tenantId: z.string().optional(),
    })
    .optional(),
});

export type SaspayTransactionData = z.infer<typeof saspayTransactionDataSchema>;

/** Normalise un champ "amount"-like venant de l'API SasPay (string ou number). */
export function toIntegerXof(v: unknown): number | null {
  if (v == null) return null;
  const n = typeof v === 'string' ? Number(v) : typeof v === 'number' ? v : NaN;
  if (!Number.isFinite(n)) return null;
  return Math.round(n);
}
