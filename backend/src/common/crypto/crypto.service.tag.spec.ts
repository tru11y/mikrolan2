import { CryptoService } from './crypto.service';

const svc = new CryptoService({ get: () => 'ab'.repeat(32) } as never);

describe('CryptoService auth tag', () => {
  it('roundtrip', () => {
    expect(svc.decrypt(svc.encrypt('secret'))).toBe('secret');
  });
  it('refuse un tag tronqué', () => {
    const [iv, tag, ct] = svc.encrypt('secret').split('.');
    const short = Buffer.from(tag, 'base64').subarray(0, 4).toString('base64');
    expect(() => svc.decrypt(`${iv}.${short}.${ct}`)).toThrow();
  });
});
