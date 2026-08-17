import * as fs from 'fs';
import { ENV_FILE } from './env-file';

// Runs inside each test file's own environment, before that file (and its
// import of AppModule, which validates env at ConfigModule.forRoot() time)
// is even loaded — unlike globalSetup, whose process.env mutations never
// reach the test file's own environment.
const written = JSON.parse(fs.readFileSync(ENV_FILE, 'utf8')) as Record<string, string>;
Object.assign(process.env, {
  NODE_ENV: 'test',
  JWT_ACCESS_SECRET: 'test-secret-that-is-at-least-32-chars-long',
  JWT_ACCESS_TTL: '900',
  JWT_REFRESH_TTL: '2592000',
  ROUTER_CRED_KEY: 'a'.repeat(64).replace(/a/g, '0'),
  CORS_ORIGINS: '',
  REDIS_HOST: 'localhost',
  REDIS_PORT: '6380',
  WG_ENABLED: 'false',
  SENTRY_DSN: '',
  SMTP_HOST: '',
  ...written,
});
