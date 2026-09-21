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

export const verifyVoucherSchema = z
  .object({
    ticket: z.string().min(1).max(64).trim(),
    password: z.string().max(64).optional(),
    routerId: z.string().uuid().optional(),
  })
  .strict();
export type VerifyVoucherDto = z.infer<typeof verifyVoucherSchema>;

// LOCAL path: the client could not push all/part of a batch over the LAN.
export const reportPushFailureSchema = z
  .object({
    batchId: z.string().uuid(),
    reason: z.string().trim().min(1).max(300),
    errorCode: z.string().trim().max(50).optional(),
    pushedCount: z.number().int().min(0).max(500).optional(),
  })
  .strict();
export type ReportPushFailureDto = z.infer<typeof reportPushFailureSchema>;
