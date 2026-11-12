import { WgAlertDeliveryRegistry, buildDeliveryOutcome, combineEmailResults } from './wg-alert-delivery';

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

describe('buildDeliveryOutcome — humanDelivered', () => {
  it.each([
    ['SENT', 'FAILED', true],
    ['FAILED', 'SENT', true],
    ['SENT', 'SENT', true],
    ['FAILED', 'FAILED', false],
    ['NOT_CONFIGURED', 'NO_TOKEN', false],
    ['NO_RECIPIENT', 'DISABLED', false],
    ['FAILED', 'INVALID_TOKEN', false],
  ] as const)('email %s + push %s => %s', (email, push, expected) => {
    expect(buildDeliveryOutcome(email, push, [], at).humanDelivered).toBe(expected);
  });

  it('ajoute les codes d absence de canal', () => {
    expect(buildDeliveryOutcome('NO_RECIPIENT', 'NO_TOKEN', [], at).failureCodes).toEqual(['EMAIL_NO_RECIPIENT', 'PUSH_NO_TOKEN']);
  });
});

describe('WgAlertDeliveryRegistry — Ops Health', () => {
  const ok = buildDeliveryOutcome('SENT', 'NO_TOKEN', [], at);
  const ko = buildDeliveryOutcome('NO_RECIPIENT', 'NO_TOKEN', [], at);

  it('vide : GREEN', () => expect(new WgAlertDeliveryRegistry().snapshot(T0).level).toBe('GREEN'));

  it('non livrée < 15 min : GREEN ; ≥ 15 min : ORANGE ; ≥ 1 h : RED', () => {
    const r = new WgAlertDeliveryRegistry();
    r.record('p1', buildDeliveryOutcome('SENT', 'SENT', [], at), T0 - 100 * MIN);
    r.record('p2', ko, T0);
    expect(r.snapshot(T0 + 5 * MIN).level).toBe('GREEN');
    expect(r.snapshot(T0 + 15 * MIN).level).toBe('ORANGE');
    const red = r.snapshot(T0 + 61 * MIN);
    expect(red.level).toBe('RED');
    expect(red.wgOpenUndeliveredOver1h).toBe(1);
  });

  it('livraison nulle sur 24 h alors qu une alerte existe : RED, même résolue', () => {
    const r = new WgAlertDeliveryRegistry();
    r.record('p1', ko, T0);
    r.resolve('p1');
    expect(r.snapshot(T0 + MIN).level).toBe('RED');
  });

  it('une alerte livrée ne laisse rien d ouvert', () => {
    const r = new WgAlertDeliveryRegistry();
    r.record('p1', ok, T0);
    const s = r.snapshot(T0 + 2 * 60 * MIN);
    expect(s).toMatchObject({ level: 'GREEN', wgAlertsCreated: 1, wgDeliveredEmail: 1, wgUndelivered: 0, wgOpenUndeliveredOver1h: 0 });
  });

  it('compteurs par cause, sans donnée sensible', () => {
    const r = new WgAlertDeliveryRegistry();
    r.record('p1', buildDeliveryOutcome('FAILED', 'INVALID_TOKEN', ['TIMEOUT'], at), T0);
    r.record('p2', ko, T0);
    r.record('p3', buildDeliveryOutcome('SENT', 'FAILED', ['HTTP_500'], at), T0);
    const s = r.snapshot(T0);
    expect(s).toMatchObject({
      wgAlertsCreated: 3,
      wgDeliveryAttemptsEmail: 2,
      wgDeliveryAttemptsPush: 2,
      wgDeliveredEmail: 1,
      wgDeliveredPush: 0,
      wgUndelivered: 2,
      wgNoRecipient: 1,
      wgNoPushToken: 1,
      wgInvalidPushToken: 1,
      wgProviderFailures: 2,
      source: 'process-memory',
    });
    expect(JSON.stringify(s)).not.toMatch(/@|ExponentPushToken/);
  });

  it('les événements de plus de 24 h sortent de la fenêtre', () => {
    const r = new WgAlertDeliveryRegistry();
    r.record('p1', ok, T0 - 25 * 60 * MIN);
    expect(r.snapshot(T0).wgAlertsCreated).toBe(0);
  });
});
