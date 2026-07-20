import { z } from 'zod';

export const proxySchema = z.object({
  method: z.enum(['GET', 'POST', 'PUT', 'PATCH', 'DELETE']).default('GET'),
  // RouterOS REST path, e.g. "/interface/print". No traversal, no host.
  path: z
    .string()
    .min(1)
    .max(200)
    .regex(/^\/[a-zA-Z0-9/_\-.]*$/, { message: 'Invalid RouterOS path' })
    .refine((p) => !p.includes('..'), { message: 'Invalid RouterOS path' }),
  data: z.record(z.unknown()).optional(),
});
export type ProxyDto = z.infer<typeof proxySchema>;
