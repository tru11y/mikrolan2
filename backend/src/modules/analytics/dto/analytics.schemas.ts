import { z } from 'zod';

// Périodes nommées + mode custom explicite (audit/67 étape 3). from/to en
// ISO 8601 uniquement en mode custom — jamais de tenantId côté client
// (toujours dérivé du contexte, comme Metrics/Accounting existants).
export const namedPeriodSchema = z.enum([
  'today',
  'yesterday',
  'last7days',
  'last30days',
  'currentWeek',
  'currentMonth',
  'custom',
]);

const baseFilters = {
  period: namedPeriodSchema.default('last30days'),
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
  routerId: z.string().uuid().optional(),
  planId: z.string().uuid().optional(),
};

function refineCustomBounds<T extends { period: string; from?: string; to?: string }>(
  data: T,
  ctx: z.RefinementCtx,
) {
  if (data.period === 'custom') {
    if (!data.from || !data.to) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'from et to sont requis en period=custom',
      });
      return;
    }
    if (new Date(data.from).getTime() >= new Date(data.to).getTime()) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'from doit être strictement antérieur à to' });
    }
  }
}

export const overviewQuerySchema = z.object(baseFilters).strict().superRefine(refineCustomBounds);
export type OverviewQueryDto = z.infer<typeof overviewQuerySchema>;

export const routersQuerySchema = z
  .object({ period: baseFilters.period, from: baseFilters.from, to: baseFilters.to })
  .strict()
  .superRefine(refineCustomBounds);
export type RoutersQueryDto = z.infer<typeof routersQuerySchema>;

export const routerDetailQuerySchema = z
  .object({ period: baseFilters.period, from: baseFilters.from, to: baseFilters.to })
  .strict()
  .superRefine(refineCustomBounds);
export type RouterDetailQueryDto = z.infer<typeof routerDetailQuerySchema>;

export const plansQuerySchema = z
  .object({ period: baseFilters.period, from: baseFilters.from, to: baseFilters.to, routerId: baseFilters.routerId })
  .strict()
  .superRefine(refineCustomBounds);
export type PlansQueryDto = z.infer<typeof plansQuerySchema>;

export const trafficQuerySchema = z
  .object({ period: baseFilters.period, from: baseFilters.from, to: baseFilters.to, routerId: baseFilters.routerId })
  .strict()
  .superRefine(refineCustomBounds);
export type TrafficQueryDto = z.infer<typeof trafficQuerySchema>;
