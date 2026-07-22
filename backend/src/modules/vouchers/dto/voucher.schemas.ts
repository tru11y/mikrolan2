import { z } from 'zod';

export const generateVouchersSchema = z
  .object({
    planId: z.string().uuid(),
    quantity: z.number().int().positive().max(500),
  })
  .strict();
export type GenerateVouchersDto = z.infer<typeof generateVouchersSchema>;

// LOCAL (free) path: the client reports the RouterOS ids it created over the LAN.
export const confirmVouchersSchema = z
  .object({
    batchId: z.string().uuid(),
    items: z
      .array(
        z.object({
          id: z.string().uuid(),
          mikrotikId: z.string().min(1).max(64),
        }),
      )
      .min(1)
      .max(500),
  })
  .strict();
export type ConfirmVouchersDto = z.infer<typeof confirmVouchersSchema>;
