import { createPlanSchema, updatePlanSchema } from './plan.schemas';

const base = { name: 'Plan', durationMinutes: 60, priceXof: 500, sharedUsers: 1 };

describe('plan code entropy floor', () => {
  it('rejects codeLength < 6', () => {
    expect(createPlanSchema.safeParse({ ...base, codeLength: 4 }).success).toBe(false);
  });
  it('rejects NUMERIC shorter than 8', () => {
    expect(createPlanSchema.safeParse({ ...base, codeFormat: 'NUMERIC', codeLength: 6 }).success).toBe(false);
    expect(updatePlanSchema.safeParse({ codeFormat: 'NUMERIC', codeLength: 7 }).success).toBe(false);
  });
  it('accepts NUMERIC 8 and ALPHANUMERIC 6', () => {
    expect(createPlanSchema.safeParse({ ...base, codeFormat: 'NUMERIC', codeLength: 8 }).success).toBe(true);
    expect(createPlanSchema.safeParse({ ...base, codeFormat: 'ALPHANUMERIC', codeLength: 6 }).success).toBe(true);
  });
});

describe('sharedUsers (appareils simultanés) — obligatoire, entier >= 1', () => {
  const { sharedUsers: _omit, ...withoutShared } = base;
  it('création sans sharedUsers refusée (aucune valeur par défaut silencieuse)', () => {
    expect(createPlanSchema.safeParse(withoutShared).success).toBe(false);
  });
  it.each([0, -1, 1.5, '2', null, Number.NaN])('création avec sharedUsers=%p refusée', (v) => {
    expect(createPlanSchema.safeParse({ ...base, sharedUsers: v }).success).toBe(false);
  });
  it('entier positif accepté, jusqu’à 1000', () => {
    for (const v of [1, 2, 50, 1000]) {
      expect(createPlanSchema.safeParse({ ...base, sharedUsers: v }).success).toBe(true);
    }
    expect(createPlanSchema.safeParse({ ...base, sharedUsers: 1001 }).success).toBe(false);
  });
  it('modification : champ absent accepté (inchangé), mais 0, négatif et décimal refusés', () => {
    expect(updatePlanSchema.safeParse({ name: 'Autre' }).success).toBe(true);
    for (const v of [0, -3, 2.5]) expect(updatePlanSchema.safeParse({ sharedUsers: v }).success).toBe(false);
    expect(updatePlanSchema.safeParse({ sharedUsers: 3 }).success).toBe(true);
  });
});
