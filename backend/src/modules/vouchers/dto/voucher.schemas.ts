import { z } from 'zod';

export const generateVouchersSchema = z
  .object({
    planId: z.string().uuid(),
    quantity: z.number().int().positive().max(500),
  })
  .strict();
export type GenerateVouchersDto = z.infer<typeof generateVouchersSchema>;
