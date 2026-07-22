import { z } from 'zod';

export const terminateSessionSchema = z
  .object({ mikrotikId: z.string().min(1).max(64) })
  .strict();
export type TerminateSessionDto = z.infer<typeof terminateSessionSchema>;
