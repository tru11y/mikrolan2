import { z } from 'zod';

export const activateSchema = z.object({
  /** Absent = la durée portée par la facture réglée (30 j par défaut). */
  periodDays: z.coerce.number().int().min(1).max(3650).optional(),
  invoiceId: z.string().uuid().optional(),
});
export type ActivateDto = z.infer<typeof activateSchema>;

export {
  requestUpgradeSchema,
  type RequestUpgradeDto,
} from './tier.schemas';
