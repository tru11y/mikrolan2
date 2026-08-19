import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// Regression guard for FIND-002: `prisma migrate deploy || true` (or any
// `set +e` around it) silently masked migration failures in the deploy job,
// letting the pipeline continue and restart the API against a broken schema.
describe('CI workflow — migration failure must not be silenced (FIND-002)', () => {
  const ciYamlPath = join(__dirname, '../../../.github/workflows/ci.yml');
  const ciYaml = readFileSync(ciYamlPath, 'utf8');

  it('contains a prisma migrate deploy step', () => {
    expect(ciYaml).toMatch(/prisma migrate deploy/);
  });

  it('does not suffix `prisma migrate deploy` with `|| true` (or any exit-code swallowing)', () => {
    const migrateLine = ciYaml
      .split('\n')
      .find((line) => line.includes('prisma migrate deploy'));
    expect(migrateLine).toBeDefined();
    expect(migrateLine).not.toMatch(/\|\|\s*true/);
    expect(migrateLine).not.toMatch(/2>\s*\/dev\/null/);
  });

  it('does not disable shell error propagation (`set +e`) anywhere in the deploy script', () => {
    expect(ciYaml).not.toMatch(/set\s+\+e/);
  });

  it('keeps `set -e` active for the deploy job so any failing step aborts the pipeline', () => {
    expect(ciYaml).toMatch(/set\s+-e/);
  });
});
