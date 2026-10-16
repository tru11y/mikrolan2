import { z } from 'zod';

const MAX_APK_BYTES = 200 * 1024 * 1024;
const MAX_VERSION_CODE = 2_100_000_000;

// Clé S3 bornée : préfixe fixe, caractères sûrs, pas de `..` ni de `/` imbriqué.
const STORAGE_KEY = /^releases\/android\/[A-Za-z0-9][A-Za-z0-9._-]{0,120}\.apk$/;

export const createReleaseSchema = z
  .object({
    versionName: z
      .string()
      .trim()
      .max(32)
      .regex(/^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/, 'Format attendu : 1.2.3'),
    versionCode: z.number().int().min(1).max(MAX_VERSION_CODE),
    minVersionCode: z.number().int().min(1).max(MAX_VERSION_CODE).default(1),
    releaseNotes: z.string().trim().min(1).max(5000),
    fileSize: z.number().int().min(1).max(MAX_APK_BYTES),
    storageKey: z
      .string()
      .regex(STORAGE_KEY, 'Clé attendue : releases/android/<nom>.apk')
      .refine((k) => !k.includes('..'), 'Clé invalide'),
  })
  .strict()
  .refine((d) => d.minVersionCode <= d.versionCode, {
    path: ['minVersionCode'],
    message: 'minVersionCode ne peut pas dépasser versionCode',
  });
export type CreateReleaseDto = z.infer<typeof createReleaseSchema>;

export const listReleasesQuerySchema = z.object({
  includeArchived: z.enum(['true', 'false']).default('false'),
  cursor: z.string().uuid().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(25),
});
export type ListReleasesQueryDto = z.infer<typeof listReleasesQuerySchema>;

export const requireReleaseSchema = z
  .object({ required: z.boolean().default(true) })
  .strict()
  .default({});
export type RequireReleaseDto = z.infer<typeof requireReleaseSchema>;
