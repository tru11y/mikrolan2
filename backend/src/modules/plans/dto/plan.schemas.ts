import { z } from 'zod';
import { PlanCodeFormat, PlanExpiration, PlanStatus } from '@prisma/client';

const kbps = z.number().int().positive().max(1_000_000);
const minutes = z.number().int().positive().max(525_600); // ≤ 1 an
const sharedUsers = z.number().int().min(1).max(1000);
const codePrefix = z
  .string()
  .trim()
  .max(12)
  .regex(/^[A-Za-z0-9]*$/, { message: 'Invalid prefix' });
const codeLength = z.number().int().min(4).max(12);

export const createPlanSchema = z.object({
  name: z.string().trim().min(2).max(100),
  description: z.string().max(500).optional(),
  durationMinutes: minutes,
  priceXof: z.number().int().min(0).max(10_000_000),
  downloadKbps: kbps.nullable().optional(),
  uploadKbps: kbps.nullable().optional(),
  dataLimitMb: z.number().int().positive().max(1_000_000).nullable().optional(),
  sharedUsers: sharedUsers.optional(),
  expirationMode: z.nativeEnum(PlanExpiration).optional(),
  displayOrder: z.number().int().min(0).max(1000).optional(),
  codePrefix: codePrefix.nullable().optional(),
  codeLength: codeLength.optional(),
  codeFormat: z.nativeEnum(PlanCodeFormat).optional(),
});
export type CreatePlanDto = z.infer<typeof createPlanSchema>;

export const updatePlanSchema = z
  .object({
    name: z.string().trim().min(2).max(100).optional(),
    description: z.string().max(500).nullable().optional(),
    durationMinutes: minutes.optional(),
    priceXof: z.number().int().min(0).max(10_000_000).optional(),
    downloadKbps: kbps.nullable().optional(),
    uploadKbps: kbps.nullable().optional(),
    dataLimitMb: z.number().int().positive().max(1_000_000).nullable().optional(),
    sharedUsers: sharedUsers.optional(),
    expirationMode: z.nativeEnum(PlanExpiration).optional(),
    displayOrder: z.number().int().min(0).max(1000).optional(),
    status: z.nativeEnum(PlanStatus).optional(),
    codePrefix: codePrefix.nullable().optional(),
    codeLength: codeLength.optional(),
    codeFormat: z.nativeEnum(PlanCodeFormat).optional(),
  })
  .strict();
export type UpdatePlanDto = z.infer<typeof updatePlanSchema>;
