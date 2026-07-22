import { z } from 'zod';

export const metricsQuerySchema = z
  .object({
    period: z.enum(['today', '7d', '30d']).default('30d'),
    routerId: z.string().uuid().optional(),
  })
  .strict();

export type MetricsQueryDto = z.infer<typeof metricsQuerySchema>;
