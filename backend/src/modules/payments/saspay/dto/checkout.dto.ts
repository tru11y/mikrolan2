import { z } from 'zod';
import { BillingPeriod } from '@prisma/client';

export const createCheckoutSchema = z.object({
  // Mobile n'envoie JAMAIS de montant : le serveur recalcule à partir du tier.
  tierKey: z.string().min(1),
  billingPeriod: z.nativeEnum(BillingPeriod).default(BillingPeriod.MONTHLY),
});

export type CreateCheckoutDto = z.infer<typeof createCheckoutSchema>;
