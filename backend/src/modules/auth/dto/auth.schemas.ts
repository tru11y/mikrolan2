import { z } from 'zod';

export const signupSchema = z.object({
  tenantName: z.string().min(2).max(80),
  email: z.string().email().max(160),
  password: z.string().min(10).max(128),
});
export type SignupDto = z.infer<typeof signupSchema>;

export const loginSchema = z.object({
  email: z.string().email().max(160),
  password: z.string().min(1).max(128),
});
export type LoginDto = z.infer<typeof loginSchema>;

export const refreshSchema = z.object({
  refreshToken: z.string().min(20),
});
export type RefreshDto = z.infer<typeof refreshSchema>;

export const updateProfileSchema = z
  .object({
    name: z.string().trim().min(1).max(100).nullable().optional(),
    country: z.string().trim().min(1).max(80).nullable().optional(),
  })
  .strict();
export type UpdateProfileDto = z.infer<typeof updateProfileSchema>;

export const changePasswordSchema = z
  .object({
    currentPassword: z.string().min(1).max(128),
    newPassword: z.string().min(10).max(128),
  })
  .strict();
export type ChangePasswordDto = z.infer<typeof changePasswordSchema>;

export const updateNotificationsSchema = z
  .object({
    enabled: z.boolean(),
  })
  .strict();
export type UpdateNotificationsDto = z.infer<typeof updateNotificationsSchema>;

export const deleteAccountSchema = z
  .object({
    password: z.string().min(1).max(128),
  })
  .strict();
export type DeleteAccountDto = z.infer<typeof deleteAccountSchema>;
