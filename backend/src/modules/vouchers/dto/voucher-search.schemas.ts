import { z } from 'zod';
import { VoucherStatus } from '@prisma/client';

/** Recherche de tickets d'un routeur : pagination curseur, recherche par préfixe de code. */
export const voucherSearchQuerySchema = z
  .object({
    q: z.string().trim().min(2).max(32).optional(),
    status: z.nativeEnum(VoucherStatus).optional(),
    batchId: z.string().uuid().optional(),
    limit: z.coerce.number().int().min(1).max(200).default(50),
    cursor: z.string().min(1).max(200).optional(),
  })
  .strict();
export type VoucherSearchQuery = z.infer<typeof voucherSearchQuerySchema>;
