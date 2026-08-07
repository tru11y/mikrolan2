import { z } from 'zod';
import { BillingPeriod } from '@prisma/client';

/** Une ligne de la liste des avantages affichée sur la carte de formule. */
export const tierFeatureSchema = z.object({
  label: z.string().trim().min(1).max(120),
  included: z.boolean(),
});
export type TierFeatureDto = z.infer<typeof tierFeatureSchema>;

// La clé identifie la formule pour l'application ; elle sert d'ancre stable
// quand le nom commercial change ("Avancé" → "Business" ne casse rien).
const tierKey = z
  .string()
  .trim()
  .min(2)
  .max(32)
  .regex(/^[a-z0-9-]+$/, {
    message: 'Key must be lowercase letters, digits or dashes',
  });

export const createTierSchema = z.object({
  key: tierKey,
  name: z.string().trim().min(2).max(60),
  monthlyXof: z.number().int().min(0).max(10_000_000),
  annualDiscount: z.number().int().min(0).max(90).optional(),
  routerLimit: z.number().int().min(1).max(10_000).nullable().optional(),
  remoteAccess: z.boolean().optional(),
  a4Printing: z.boolean().optional(),
  cloudBackup: z.boolean().optional(),
  prioritySupport: z.boolean().optional(),
  badge: z.string().trim().max(30).nullable().optional(),
  tagline: z.string().trim().max(80).nullable().optional(),
  features: z.array(tierFeatureSchema).max(20),
  displayOrder: z.number().int().min(0).max(1000).optional(),
  active: z.boolean().optional(),
});
export type CreateTierDto = z.infer<typeof createTierSchema>;

export const updateTierSchema = createTierSchema.partial().omit({ key: true }).strict();
export type UpdateTierDto = z.infer<typeof updateTierSchema>;

export const requestUpgradeSchema = z.object({
  note: z.string().max(280).optional(),
  /** Formule visée. Absente = la moins chère qui donne l'accès distant. */
  tierKey: tierKey.optional(),
  billingPeriod: z.nativeEnum(BillingPeriod).optional(),
});
export type RequestUpgradeDto = z.infer<typeof requestUpgradeSchema>;
