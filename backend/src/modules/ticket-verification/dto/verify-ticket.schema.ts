import { z } from 'zod';

// Strict object: any extra field (routerId, tenantId, hotspotId, sellerId,
// userId, role, …) is refused by the Zod pipe → BadRequest. The scope is
// NEVER taken from the client; it is injected by TicketVerifierScopeGuard.
export const verifyTicketSchema = z
  .object({
    // Zod's .min() runs before .trim(), so "   " would pass .min(1). We trim
    // first, then enforce 1..64 characters on the trimmed value.
    ticketCode: z
      .string()
      .max(64)
      .transform((v) => v.trim())
      .pipe(z.string().min(1).max(64)),
  })
  .strict();

export type VerifyTicketDto = z.infer<typeof verifyTicketSchema>;
