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
