import { z } from 'zod';

export const metricsQuerySchema = z
  .object({
    period: z.enum(['today', '7d', '30d']).default('30d'),
    routerId: z.string().uuid().optional(),
  })
  .strict();

export type MetricsQueryDto = z.infer<typeof metricsQuerySchema>;

export const clientsQuerySchema = z
  .object({
    limit: z.coerce.number().int().min(1).max(100).default(30),
  })
  .strict();

export type ClientsQueryDto = z.infer<typeof clientsQuerySchema>;
