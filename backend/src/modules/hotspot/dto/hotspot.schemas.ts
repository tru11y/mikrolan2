import { z } from 'zod';

export const configureHotspotSchema = z
  .object({
    // RouterOS interface (or bridge) the hotspot runs on, e.g. "bridge", "wlan1".
    interface: z
      .string()
      .trim()
      .min(1)
      .max(64)
      .regex(/^[a-zA-Z0-9._\- ]+$/, { message: 'Invalid interface' }),
    // Client subnet in CIDR. Gateway = .1, DHCP pool = .10–.254.
    network: z
      .string()
      .regex(/^(\d{1,3}\.){3}\d{1,3}\/\d{1,2}$/, { message: 'Invalid CIDR' })
      .optional(),
    dns: z
      .string()
      .regex(/^(\d{1,3}\.){3}\d{1,3}$/, { message: 'Invalid DNS' })
      .optional(),
  })
  .strict();
export type ConfigureHotspotDto = z.infer<typeof configureHotspotSchema>;

const macAddress = z
  .string()
  .trim()
  .regex(/^([0-9A-Fa-f]{2}:){5}[0-9A-Fa-f]{2}$/, { message: 'Invalid MAC' });
const ipAddress = z
  .string()
  .trim()
  .regex(/^(\d{1,3}\.){3}\d{1,3}$/, { message: 'Invalid IP' });

export const createIpBindingSchema = z
  .object({
    macAddress,
    ipAddress: ipAddress.optional(),
    server: z.string().trim().max(64).optional(),
    type: z.enum(['bypassed', 'blocked', 'regular']),
    comment: z.string().trim().max(200).optional(),
  })
  .strict();
export type CreateIpBindingDto = z.infer<typeof createIpBindingSchema>;

export const setInternetSharingSchema = z
  .object({ blocked: z.boolean() })
  .strict();
export type SetInternetSharingDto = z.infer<typeof setInternetSharingSchema>;
