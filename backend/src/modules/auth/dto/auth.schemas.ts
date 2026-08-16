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

export const registerPushTokenSchema = z
  .object({
    token: z.string().min(10).max(200),
  })
  .strict();
export type RegisterPushTokenDto = z.infer<typeof registerPushTokenSchema>;

export const deleteAccountSchema = z
  .object({
    password: z.string().min(1).max(128).optional(),
    googleIdToken: z.string().min(20).max(4000).optional(),
  })
  .strict()
  .refine((d) => d.password || d.googleIdToken, {
    message: 'Mot de passe ou token Google requis.',
  });
export type DeleteAccountDto = z.infer<typeof deleteAccountSchema>;

export const setPasswordSchema = z
  .object({
    password: z.string().min(10).max(128),
  })
  .strict();
export type SetPasswordDto = z.infer<typeof setPasswordSchema>;

export const requestPasswordResetSchema = z
  .object({
    email: z.string().email().max(160),
  })
  .strict();
export type RequestPasswordResetDto = z.infer<typeof requestPasswordResetSchema>;

export const confirmPasswordResetSchema = z
  .object({
    email: z.string().email().max(160),
    code: z.string().length(6),
    newPassword: z.string().min(10).max(128),
  })
  .strict();
export type ConfirmPasswordResetDto = z.infer<typeof confirmPasswordResetSchema>;

export const googleOAuthSchema = z
  .object({
    idToken: z.string().min(20).max(4000),
    nonce: z.string().min(1).max(200).optional(),
  })
  .strict();
export type GoogleOAuthDto = z.infer<typeof googleOAuthSchema>;
