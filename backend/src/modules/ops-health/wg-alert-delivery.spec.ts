import { buildDeliveryOutcome, combineEmailResults, deliveryEntityRef } from './wg-alert-delivery';

const T0 = Date.UTC(2026, 10, 12, 12, 0, 0);
const MIN = 60_000;
const at = new Date(T0);

describe('combineEmailResults', () => {
  it('aucun envoi tenté : NO_RECIPIENT', () => expect(combineEmailResults([]).status).toBe('NO_RECIPIENT'));
  it('un SENT parmi des échecs : SENT, codes conservés', () => {
    expect(combineEmailResults([{ status: 'FAILED', failureCode: 'TIMEOUT' }, { status: 'SENT' }])).toEqual({
      status: 'SENT',
      failureCodes: ['TIMEOUT'],
    });
  });
  it('échec : FAILED', () => expect(combineEmailResults([{ status: 'FAILED', failureCode: 'SMTP_ERROR' }]).status).toBe('FAILED'));
  it('SMTP absent : NOT_CONFIGURED', () => expect(combineEmailResults([{ status: 'NOT_CONFIGURED' }]).status).toBe('NOT_CONFIGURED'));
});

describe('buildDeliveryOutcome — providerAccepted', () => {
  it.each([
    ['SENT', 'FAILED', true],
    ['FAILED', 'SENT', true],
    ['SENT', 'SENT', true],
    ['FAILED', 'FAILED', false],
    ['NOT_CONFIGURED', 'NO_TOKEN', false],
    ['NO_RECIPIENT', 'DISABLED', false],
    ['FAILED', 'INVALID_TOKEN', false],
  ] as const)('email %s + push %s => %s', (email, push, expected) => {
    expect(buildDeliveryOutcome(email, push, [], at).providerAccepted).toBe(expected);
  });

  it('ajoute les codes d absence de canal', () => {
    expect(buildDeliveryOutcome('NO_RECIPIENT', 'NO_TOKEN', [], at).failureCodes).toEqual(['EMAIL_NO_RECIPIENT', 'PUSH_NO_TOKEN']);
  });
});

describe('deliveryEntityRef', () => {
  it('stable, 16 hex, non réversible directement, distincte par entrée', () => {
    const a = deliveryEntityRef('tenant-uuid-1');
    expect(a).toBe(deliveryEntityRef('tenant-uuid-1'));
    expect(a).toMatch(/^[0-9a-f]{16}$/);
    expect(a).not.toContain('tenant');
    expect(deliveryEntityRef('tenant-uuid-2')).not.toBe(a);
  });
});
