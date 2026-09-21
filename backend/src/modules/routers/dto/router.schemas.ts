import { z } from 'zod';
import { ManagementMode } from '@prisma/client';

// host:port or host — validated loosely, RouterOS reachability checked at use.
const addressSchema = z
  .string()
  .min(3)
  .max(120)
  .regex(/^[a-zA-Z0-9.\-:]+$/, { message: 'Invalid address' });

const credentialsSchema = z.object({
  username: z.string().min(1).max(64),
  password: z.string().min(1).max(128),
});

export const createRouterSchema = z.object({
  identity: z
    .string()
    .trim()
    .min(2)
    .max(64)
    // RouterOS identities can contain spaces and accents (e.g. "FREEDOM HOME").
    .regex(/^[\p{L}\p{N} ._-]+$/u, { message: 'Invalid identity' }),
  alias: z.string().max(80).optional(),
  model: z.string().max(60).optional(),
  localAddress: addressSchema.optional(),
  mode: z.nativeEnum(ManagementMode).default(ManagementMode.LOCAL),
  credentials: credentialsSchema.optional(),
});
export type CreateRouterDto = z.infer<typeof createRouterSchema>;

export const updateRouterSchema = z
  .object({
    alias: z.string().max(80).nullable().optional(),
    model: z.string().max(60).nullable().optional(),
    localAddress: addressSchema.nullable().optional(),
    mode: z.nativeEnum(ManagementMode).optional(),
    credentials: credentialsSchema.nullable().optional(),
    pushNotifications: z.boolean().optional(),
  })
  .strict();
export type UpdateRouterDto = z.infer<typeof updateRouterSchema>;

// Actions performed by the app directly over the LAN: the server cannot see
// them, so the client reports the outcome to keep the audit trail complete.
export const CLIENT_EVENT_KINDS = ['REBOOT', 'HOTSPOT_RESET', 'LAN_CONNECT'] as const;
export const clientEventSchema = z
  .object({
    kind: z.enum(CLIENT_EVENT_KINDS),
    outcome: z.enum(['SUCCESS', 'WARNING', 'PARTIAL_SUCCESS', 'FAILED']),
    errorCode: z.string().trim().max(50).optional(),
    message: z.string().trim().max(300).optional(),
  })
  .strict();
export type ClientEventDto = z.infer<typeof clientEventSchema>;
