import { createPlanSchema, updatePlanSchema } from './plan.schemas';

const base = { name: 'Plan', durationMinutes: 60, priceXof: 500 };

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
