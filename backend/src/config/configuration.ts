import { z } from 'zod';

const envSchema = z.object({
  NODE_ENV: z
    .enum(['development', 'test', 'production'])
    .default('development'),
  PORT: z.coerce.number().int().positive().default(3001),

  DATABASE_URL: z.string().url(),

  REDIS_HOST: z.string().default('localhost'),
  REDIS_PORT: z.coerce.number().int().positive().default(6380),

  JWT_ACCESS_SECRET: z.string().min(32),
  JWT_REFRESH_SECRET: z.string().min(32),
  JWT_ACCESS_TTL: z.coerce.number().int().positive().default(900),
  JWT_REFRESH_TTL: z.coerce.number().int().positive().default(2592000),

  // 32-byte AES-256-GCM key, hex-encoded (64 hex chars)
  ROUTER_CRED_KEY: z.string().regex(/^[0-9a-fA-F]{64}$/, {
    message: 'ROUTER_CRED_KEY must be 64 hex chars (32 bytes)',
  }),

  CORS_ORIGINS: z
    .string()
    .default('')
    .transform((v) =>
      v
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean),
    ),

  // ─── WireGuard remote access (real on VPS, stubbed in dev) ──
  WG_ENABLED: z
    .enum(['true', 'false'])
    .default('false')
    .transform((v) => v === 'true'),
  WG_INTERFACE: z.string().default('wg-mgmt'),
  WG_SERVER_PUBLIC_KEY: z.string().default(''),
  WG_ENDPOINT: z.string().default('0.0.0.0:51821'),
  WG_SUBNET_BASE: z
    .string()
    .regex(/^(\d{1,3}\.){3}\d{1,3}\/\d{1,2}$/)
    .default('10.20.0.0/24'),
  WG_PORT_MIN: z.coerce.number().int().min(1024).max(65535).default(41000),
  WG_PORT_MAX: z.coerce.number().int().min(1024).max(65535).default(41999),
});

export type AppConfig = z.infer<typeof envSchema>;

export function validateEnv(raw: Record<string, unknown>): AppConfig {
  const parsed = envSchema.safeParse(raw);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `  - ${i.path.join('.')}: ${i.message}`)
      .join('\n');
    throw new Error(`Invalid environment configuration:\n${issues}`);
  }
  return parsed.data;
}
