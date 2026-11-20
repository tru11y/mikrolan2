import { z } from 'zod';
import { RouterLinkAuthMode } from '@prisma/client';

export const createRouterLinkSchema = z.object({
  name: z.string().trim().min(1).max(80),
  authMode: z.nativeEnum(RouterLinkAuthMode),
  routerIds: z.array(z.string().uuid()).min(1).max(50),
});
export type CreateRouterLinkDto = z.infer<typeof createRouterLinkSchema>;

export const addMembersSchema = z.object({
  routerIds: z.array(z.string().uuid()).min(1).max(50),
});
export type AddMembersDto = z.infer<typeof addMembersSchema>;

export const setAuthModeSchema = z.object({
  authMode: z.nativeEnum(RouterLinkAuthMode),
});
export type SetAuthModeDto = z.infer<typeof setAuthModeSchema>;
