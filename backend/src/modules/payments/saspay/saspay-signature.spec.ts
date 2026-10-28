import { createHmac } from 'node:crypto';
import { verifySaspayWebhook, hashSaspayEvent } from './saspay-signature';

const SECRET = 'whsec_test_abcdefghijklmnop';

function sign(timestamp: number, body: string, secret = SECRET): string {
  return createHmac('sha256', secret).update(`${timestamp}.${body}`).digest('hex');
}

describe('verifySaspayWebhook', () => {
  const BODY = '{"event":"transaction.success","data":{"id":"abc"}}';
  const NOW = 1_740_000_000;

  it('accepts a valid signature within the tolerance window', () => {
    const ts = NOW - 10;
    const sig = sign(ts, BODY);
    const res = verifySaspayWebhook({
      rawBody: BODY,
      signatureHeader: sig,
      timestampHeader: String(ts),
      secret: SECRET,
      nowSeconds: NOW,
    });
    expect(res).toEqual({ ok: true });
  });

  it('rejects an expired timestamp (> 5 min old)', () => {
    const ts = NOW - 301;
    const sig = sign(ts, BODY);
    const res = verifySaspayWebhook({
      rawBody: BODY,
      signatureHeader: sig,
      timestampHeader: String(ts),
      secret: SECRET,
      nowSeconds: NOW,
    });
    expect(res).toEqual({ ok: false, reason: 'expired_timestamp' });
  });

  it('rejects a future timestamp (> 5 min ahead = clock skew attack)', () => {
    const ts = NOW + 301;
    const sig = sign(ts, BODY);
    const res = verifySaspayWebhook({
      rawBody: BODY,
      signatureHeader: sig,
      timestampHeader: String(ts),
      secret: SECRET,
      nowSeconds: NOW,
    });
    expect(res).toEqual({ ok: false, reason: 'expired_timestamp' });
  });

  it('rejects a tampered body (re-serialized JSON = different signature)', () => {
    const ts = NOW;
    const sig = sign(ts, BODY);
    const tampered = BODY.replace('abc', 'xyz');
    const res = verifySaspayWebhook({
      rawBody: tampered,
      signatureHeader: sig,
      timestampHeader: String(ts),
      secret: SECRET,
      nowSeconds: NOW,
    });
    expect(res).toEqual({ ok: false, reason: 'signature_mismatch' });
  });

  it('rejects a signature made with another secret', () => {
    const ts = NOW;
    const sig = sign(ts, BODY, 'wrong_secret');
    const res = verifySaspayWebhook({
      rawBody: BODY,
      signatureHeader: sig,
      timestampHeader: String(ts),
      secret: SECRET,
      nowSeconds: NOW,
    });
    expect(res).toEqual({ ok: false, reason: 'signature_mismatch' });
  });

  it('rejects an attacker-replayed webhook with a rejuvenated timestamp (signature breaks)', () => {
    const originalTs = NOW - 1000;
    const originalSig = sign(originalTs, BODY);
    const res = verifySaspayWebhook({
      rawBody: BODY,
      signatureHeader: originalSig,
      timestampHeader: String(NOW),
      secret: SECRET,
      nowSeconds: NOW,
    });
    expect(res).toEqual({ ok: false, reason: 'signature_mismatch' });
  });

  it('rejects missing headers', () => {
    const base = { rawBody: BODY, secret: SECRET, nowSeconds: NOW };
    expect(
      verifySaspayWebhook({ ...base, signatureHeader: undefined, timestampHeader: '1' }),
    ).toEqual({ ok: false, reason: 'missing_signature' });
    expect(
      verifySaspayWebhook({ ...base, signatureHeader: 'x', timestampHeader: undefined }),
    ).toEqual({ ok: false, reason: 'missing_timestamp' });
  });

  it('rejects a non-numeric timestamp header', () => {
    const res = verifySaspayWebhook({
      rawBody: BODY,
      signatureHeader: 'anything',
      timestampHeader: 'not-a-number',
      secret: SECRET,
      nowSeconds: NOW,
    });
    expect(res).toEqual({ ok: false, reason: 'invalid_timestamp' });
  });

  it('rejects when the secret is empty (fail-closed)', () => {
    const ts = NOW;
    const res = verifySaspayWebhook({
      rawBody: BODY,
      signatureHeader: sign(ts, BODY),
      timestampHeader: String(ts),
      secret: '',
      nowSeconds: NOW,
    });
    expect(res).toEqual({ ok: false, reason: 'missing_secret' });
  });

  it('accepts a raw body passed as Buffer', () => {
    const ts = NOW;
    const sig = sign(ts, BODY);
    const res = verifySaspayWebhook({
      rawBody: Buffer.from(BODY, 'utf8'),
      signatureHeader: sig,
      timestampHeader: String(ts),
      secret: SECRET,
      nowSeconds: NOW,
    });
    expect(res).toEqual({ ok: true });
  });
});

describe('hashSaspayEvent', () => {
  it('is deterministic for identical inputs', () => {
    expect(hashSaspayEvent('123', 'abc')).toBe(hashSaspayEvent('123', 'abc'));
  });

  it('differs for different timestamps (collision resistance across retries)', () => {
    expect(hashSaspayEvent('123', 'abc')).not.toBe(hashSaspayEvent('124', 'abc'));
  });

  it('differs for different signatures', () => {
    expect(hashSaspayEvent('123', 'abc')).not.toBe(hashSaspayEvent('123', 'abd'));
  });
});
