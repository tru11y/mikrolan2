import { z } from 'zod';
import { DEFAULT_HORIZON_DAYS, MAX_HORIZON_DAYS, MIN_HORIZON_DAYS } from './forecast.constants';

export const forecastQuerySchema = z
  .object({
    horizonDays: z.coerce.number().int().min(MIN_HORIZON_DAYS).max(MAX_HORIZON_DAYS).default(DEFAULT_HORIZON_DAYS),
    routerId: z.string().uuid().optional(),
    planId: z.string().uuid().optional(),
  })
  .strict();
export type ForecastQueryDto = z.infer<typeof forecastQuerySchema>;

export const forecastTrafficQuerySchema = z
  .object({
    routerId: z.string().uuid().optional(),
  })
  .strict();
export type ForecastTrafficQueryDto = z.infer<typeof forecastTrafficQuerySchema>;
