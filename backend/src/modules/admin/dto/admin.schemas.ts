import { z } from 'zod';
import {
  AuditAction,
  PaymentStatus,
  TenantStatus,
  UserStatus,
} from '@prisma/client';

/**
 * Pagination par curseur : l'id du dernier élément reçu. Un `offset` dérive dès
 * qu'une ligne est insérée pendant la consultation, et coûte de plus en plus
 * cher à mesure que la table grandit.
 */
const cursor = z.string().uuid().optional();
const limit = z.coerce.number().int().min(1).max(100).default(25);

// Recherche à partir de 3 caractères seulement : en dessous, `?q=a` revient à
// énumérer les adresses e-mail de la plateforme.
const search = z.string().trim().min(3).max(120).optional();

export const listTenantsQuerySchema = z.object({
  status: z.nativeEnum(TenantStatus).optional(),
  q: search,
  cursor,
  limit,
});
export type ListTenantsQueryDto = z.infer<typeof listTenantsQuerySchema>;

export const listUsersQuerySchema = z.object({
  tenantId: z.string().uuid().optional(),
  status: z.nativeEnum(UserStatus).optional(),
  q: search,
  cursor,
  limit,
});
export type ListUsersQueryDto = z.infer<typeof listUsersQuerySchema>;

export const listInvoicesQuerySchema = z.object({
  status: z.nativeEnum(PaymentStatus).default(PaymentStatus.PENDING),
  cursor,
  limit,
});
export type ListInvoicesQueryDto = z.infer<typeof listInvoicesQuerySchema>;

export const listAuditQuerySchema = z.object({
  tenantId: z.string().uuid().optional(),
  action: z.nativeEnum(AuditAction).optional(),
  cursor,
  limit,
});
export type ListAuditQueryDto = z.infer<typeof listAuditQuerySchema>;

// Seuls deux états sont pilotables : `DELETED` relève de la suppression de
// compte par son propriétaire, pas d'une décision d'administration.
export const setTenantStatusSchema = z.object({
  status: z.enum([TenantStatus.ACTIVE, TenantStatus.SUSPENDED]),
  reason: z.string().trim().max(280).optional(),
});
export type SetTenantStatusDto = z.infer<typeof setTenantStatusSchema>;

export const setUserStatusSchema = z.object({
  status: z.enum([UserStatus.ACTIVE, UserStatus.SUSPENDED]),
  reason: z.string().trim().max(280).optional(),
});
export type SetUserStatusDto = z.infer<typeof setUserStatusSchema>;
