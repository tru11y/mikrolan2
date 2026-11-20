import { validateEnv } from './configuration';

const base = {
  NODE_ENV: 'production',
  DATABASE_URL: 'postgresql://u:p@127.0.0.1:5432/db',
  JWT_ACCESS_SECRET: 'x'.repeat(40),
  ROUTER_CRED_KEY: 'ab'.repeat(32),
  RADIUS_INTERNAL_TOKEN: 'prod-radius-shared-secret',
};

describe('validateEnv (production)', () => {
  it('accepte une config valide', () => {
    expect(validateEnv(base).NODE_ENV).toBe('production');
  });
  it('refuse un RADIUS_INTERNAL_TOKEN vide quand RADIUS_ENABLED en production', () => {
    expect(() =>
      validateEnv({ ...base, RADIUS_ENABLED: 'true', RADIUS_INTERNAL_TOKEN: '' }),
    ).toThrow(/RADIUS_INTERNAL_TOKEN/);
  });
  it('tolère un RADIUS_INTERNAL_TOKEN vide quand le module est dark (RADIUS_ENABLED absent)', () => {
    expect(() => validateEnv({ ...base, RADIUS_INTERNAL_TOKEN: '' })).not.toThrow();
  });
  it('refuse le secret JWT d\'exemple', () => {
    expect(() =>
      validateEnv({ ...base, JWT_ACCESS_SECRET: 'change-me-access-32-chars-minimum-secret' }),
    ).toThrow(/JWT_ACCESS_SECRET/);
  });
  it('refuse la clé routeur à zéros', () => {
    expect(() => validateEnv({ ...base, ROUTER_CRED_KEY: '0'.repeat(64) })).toThrow(/ROUTER_CRED_KEY/);
  });
  it('tolère les valeurs d\'exemple hors production', () => {
    expect(() =>
      validateEnv({ ...base, NODE_ENV: 'development', ROUTER_CRED_KEY: '0'.repeat(64) }),
    ).not.toThrow();
  });
});
