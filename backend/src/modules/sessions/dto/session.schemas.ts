import { z } from 'zod';

export const terminateSessionSchema = z
  .object({ mikrotikId: z.string().min(1).max(64) })
  .strict();
export type TerminateSessionDto = z.infer<typeof terminateSessionSchema>;

// What the mobile app read on `/ip/hotspot/active` over the LAN, for a router
// the server cannot reach itself. Mirrors LiveSession.
export const syncLanSessionsSchema = z
  .object({
    active: z
      .array(
        z
          .object({
            id: z.string().max(64).default(''),
            user: z.string().min(1).max(128),
            ipAddress: z.string().max(64).nullable().default(null),
            macAddress: z.string().max(64).nullable().default(null),
            bytesIn: z.string().max(32).default('0'),
            bytesOut: z.string().max(32).default('0'),
            uptime: z.string().max(32).nullable().default(null),
          })
          .strict(),
      )
      .max(500),
  })
  .strict();
export type SyncLanSessionsDto = z.infer<typeof syncLanSessionsSchema>;
