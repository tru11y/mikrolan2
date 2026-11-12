import { WgAlertDeliveryRegistry, buildDeliveryOutcome, combineEmailResults, deliveryEntityRef } from './wg-alert-delivery';

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

function scanned(): WgAlertDeliveryRegistry {
  const r = new WgAlertDeliveryRegistry();
  r.markScanned();
  return r;
}

describe('deliveryEntityRef', () => {
  it('stable, 16 hex, non réversible directement, distincte par entrée', () => {
    const a = deliveryEntityRef('tenant-uuid-1');
    expect(a).toBe(deliveryEntityRef('tenant-uuid-1'));
    expect(a).toMatch(/^[0-9a-f]{16}$/);
    expect(a).not.toContain('tenant');
    expect(deliveryEntityRef('tenant-uuid-2')).not.toBe(a);
  });
});

describe('WgAlertDeliveryRegistry — Ops Health', () => {
  const ok = buildDeliveryOutcome('SENT', 'NO_TOKEN', [], at);
  const ko = buildDeliveryOutcome('NO_RECIPIENT', 'NO_TOKEN', [], at);

  it('vide : GREEN', () => expect(scanned().snapshot(T0).level).toBe('GREEN'));

  it('non livrée < 15 min : GREEN ; ≥ 15 min : ORANGE ; ≥ 1 h : RED', () => {
    const r = scanned();
    r.record('p1', buildDeliveryOutcome('SENT', 'SENT', [], at), T0 - 100 * MIN);
    r.record('p2', ko, T0);
    expect(r.snapshot(T0 + 5 * MIN).level).toBe('GREEN');
    expect(r.snapshot(T0 + 15 * MIN).level).toBe('ORANGE');
    const red = r.snapshot(T0 + 61 * MIN);
    expect(red.level).toBe('RED');
    expect(red.wgOpenUndeliveredOver1h).toBe(1);
  });

  it('livraison nulle sur 24 h alors qu une alerte existe : RED, même résolue', () => {
    const r = scanned();
    r.record('p1', ko, T0);
    r.resolve('p1');
    expect(r.snapshot(T0 + MIN).level).toBe('RED');
  });

  it('une alerte livrée ne laisse rien d ouvert', () => {
    const r = scanned();
    r.record('p1', ok, T0);
    const s = r.snapshot(T0 + 2 * 60 * MIN);
    expect(s).toMatchObject({ level: 'GREEN', wgAlertsCreated: 1, wgDeliveredEmail: 1, wgUndelivered: 0, wgOpenUndeliveredOver1h: 0 });
  });

  it('compteurs par cause, sans donnée sensible', () => {
    const r = scanned();
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
      persistence: 'MEMORY_ONLY',
      resetOnRestart: true,
      deliveryProofDurable: false,
      wgDeliveryProofDurable: false,
    });
    expect(JSON.stringify(s)).not.toMatch(/@|ExponentPushToken/);
  });

  it('les événements de plus de 24 h sortent de la fenêtre', () => {
    const r = scanned();
    r.record('p1', ok, T0 - 25 * 60 * MIN);
    expect(r.snapshot(T0).wgAlertsCreated).toBe(0);
  });
});

describe('WgAlertDeliveryRegistry — redémarrage', () => {
  const accepted = buildDeliveryOutcome('SENT', 'NO_TOKEN', [], at);
  const failed = buildDeliveryOutcome('NO_RECIPIENT', 'NO_TOKEN', [], at);

  it('registre neuf, première passe pas terminée : jamais GREEN', () => {
    const s = new WgAlertDeliveryRegistry().snapshot(T0);
    expect(s).toMatchObject({ level: 'ORANGE', scanPending: true });
  });

  it('redémarrage simulé avec staleAlertedAt existant et registre vide : ORANGE / livraison inconnue, pas « accepté »', () => {
    const r = new WgAlertDeliveryRegistry();
    r.observeAlerted('peer-1'); // le cron voit un peer déjà marqué, sans preuve en mémoire
    r.markScanned();
    const s = r.snapshot(T0);
    expect(s).toMatchObject({
      level: 'ORANGE',
      wgUnknownDeliveryAfterRestart: 1,
      message: 'livraison inconnue après redémarrage',
      wgDeliveredEmail: 0,
      wgDeliveredPush: 0,
      resetOnRestart: true,
      deliveryProofDurable: false,
      wgDeliveryProofDurable: false,
    });
    expect(typeof s.wgDeliveryRegistryStartedAt).toBe('string');
  });

  it('registre avec acceptation réelle : état accepté (plus inconnu)', () => {
    const r = scanned();
    r.observeAlerted('peer-1');
    r.record('peer-1', accepted, T0);
    expect(r.snapshot(T0 + MIN)).toMatchObject({ level: 'GREEN', wgUnknownDeliveryAfterRestart: 0, wgUndelivered: 0, wgDeliveredEmail: 1 });
  });

  it('registre avec échec : non livré', () => {
    const r = scanned();
    r.observeAlerted('peer-1');
    r.record('peer-1', failed, T0);
    expect(r.snapshot(T0 + MIN)).toMatchObject({ wgUnknownDeliveryAfterRestart: 0, wgUndelivered: 1, level: 'RED' });
  });

  it('aucun incident stale : GREEN autorisé', () => {
    expect(scanned().snapshot(T0)).toMatchObject({ level: 'GREEN', wgUnknownDeliveryAfterRestart: 0, message: null });
  });

  it('tunnel résolu : plus d inconnu', () => {
    const r = scanned();
    r.observeAlerted('peer-1');
    r.resolve('peer-1');
    expect(r.snapshot(T0).level).toBe('GREEN');
  });
});
