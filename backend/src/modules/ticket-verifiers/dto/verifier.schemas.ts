import { z } from 'zod';

// Strict DTOs — refuse any field that could escalate privileges (role,
// tenantId, status not whitelisted, assignedById, deletedAt, refreshToken,
// passwordHash, userId). The service always re-derives those from the
// authenticated manager's context.

// Minimum shared with the auth service: argon2id-grade password.
// signup uses .min(8), we align here.
const passwordField = z.string().min(8).max(128);
const emailField = z.string().email().max(254);
const nameField = z.string().trim().min(1).max(120);
const routerIdField = z.string().uuid();

export const createVerifierSchema = z
  .object({
    email: emailField,
    password: passwordField,
    name: nameField.optional(),
    routerId: routerIdField.optional(),
  })
  .strict();
export type CreateVerifierDto = z.infer<typeof createVerifierSchema>;

export const updateVerifierSchema = z
  .object({
    name: nameField,
  })
  .strict();
export type UpdateVerifierDto = z.infer<typeof updateVerifierSchema>;

export const upsertAssignmentSchema = z
  .object({
    routerId: routerIdField,
  })
  .strict();
export type UpsertAssignmentDto = z.infer<typeof upsertAssignmentSchema>;

// Only ACTIVE and SUSPENDED are reachable via the status endpoint; DELETED
// goes through DELETE /ticket-verifiers/:id (soft-delete).
export const updateStatusSchema = z
  .object({
    status: z.enum(['ACTIVE', 'SUSPENDED']),
  })
  .strict();
export type UpdateStatusDto = z.infer<typeof updateStatusSchema>;

export const listVerifiersQuerySchema = z
  .object({
    status: z.enum(['ACTIVE', 'SUSPENDED', 'DELETED']).optional(),
    routerId: routerIdField.optional(),
    search: z.string().trim().min(1).max(80).optional(),
    cursor: z.string().uuid().optional(),
    limit: z.coerce.number().int().min(1).max(100).default(50),
  })
  .strict();
export type ListVerifiersQuery = z.infer<typeof listVerifiersQuerySchema>;
