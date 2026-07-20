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
