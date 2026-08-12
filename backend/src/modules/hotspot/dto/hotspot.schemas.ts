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

// « 5M/10M », « 512k/1M »… le format RouterOS `upload/download`.
const rateLimit = z
  .string()
  .trim()
  .regex(/^\d+[kMG]?\/\d+[kMG]?$/, { message: 'Invalid rate limit' });

export const updateUserProfileSchema = z
  .object({
    name: z
      .string()
      .trim()
      .min(1)
      .max(64)
      .regex(/^[a-zA-Z0-9._\- ]+$/, { message: 'Invalid profile name' })
      .optional(),
    sharedUsers: z.number().int().min(1).max(1000).optional(),
    rateLimit: rateLimit.nullable().optional(),
  })
  .strict()
  .refine((v) => Object.keys(v).length > 0, {
    message: 'Aucune modification fournie',
  });
export type UpdateUserProfileDto = z.infer<typeof updateUserProfileSchema>;

const dnsHostname = z
  .string()
  .trim()
  .min(1)
  .max(253)
  .regex(/^[a-zA-Z0-9]([a-zA-Z0-9-]*[a-zA-Z0-9])?(\.[a-zA-Z0-9]([a-zA-Z0-9-]*[a-zA-Z0-9])?)*$/, {
    message: 'Invalid DNS name',
  });

export const hotspotSettingsQuerySchema = z
  .object({ server: z.string().trim().min(1).max(64).default('hotspot1') })
  .strict();
export type HotspotSettingsQueryDto = z.infer<typeof hotspotSettingsQuerySchema>;

export const updateHotspotSettingsSchema = z
  .object({
    server: z.string().trim().min(1).max(64).default('hotspot1'),
    idleTimeoutMinutes: z.number().int().min(1).max(1440).nullable().optional(),
    dnsName: dnsHostname.nullable().optional(),
  })
  .strict();
export type UpdateHotspotSettingsDto = z.infer<
  typeof updateHotspotSettingsSchema
>;
