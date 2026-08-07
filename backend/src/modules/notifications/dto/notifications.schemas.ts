import { z } from 'zod';

export const listNotificationsQuerySchema = z
  .object({
    unreadOnly: z.enum(['true', 'false']).default('false'),
    limit: z.coerce.number().int().min(1).max(100).default(30),
  })
  .strict();
export type ListNotificationsQueryDto = z.infer<
  typeof listNotificationsQuerySchema
>;
