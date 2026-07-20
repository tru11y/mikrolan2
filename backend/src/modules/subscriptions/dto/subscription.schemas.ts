import { z } from 'zod';

export const requestUpgradeSchema = z.object({
  note: z.string().max(280).optional(),
});
export type RequestUpgradeDto = z.infer<typeof requestUpgradeSchema>;

export const activateSchema = z.object({
  periodDays: z.coerce.number().int().min(1).max(3650).default(30),
  invoiceId: z.string().uuid().optional(),
});
export type ActivateDto = z.infer<typeof activateSchema>;
