import { ExecutionContext } from '@nestjs/common';
import { RadiusInternalGuard } from './radius-internal.guard';

const TOKEN = 'super-secret-radius-token';

function configWith(token: string) {
  return { get: () => token } as never;
}

function ctxFor(req: { ip?: string; headers?: Record<string, unknown> }): ExecutionContext {
  return {
    switchToHttp: () => ({ getRequest: () => ({ ip: req.ip, headers: req.headers ?? {} }) }),
  } as unknown as ExecutionContext;
}

describe('RadiusInternalGuard', () => {
  it('accepte une requête loopback avec le bon token', () => {
    const guard = new RadiusInternalGuard(configWith(TOKEN));
    expect(
      guard.canActivate(ctxFor({ ip: '127.0.0.1', headers: { 'x-radius-token': TOKEN } })),
    ).toBe(true);
    expect(
      guard.canActivate(ctxFor({ ip: '::1', headers: { 'x-radius-token': TOKEN } })),
    ).toBe(true);
  });

  it('rejette une requête hors loopback même avec le bon token', () => {
    const guard = new RadiusInternalGuard(configWith(TOKEN));
    expect(
      guard.canActivate(ctxFor({ ip: '10.0.0.5', headers: { 'x-radius-token': TOKEN } })),
    ).toBe(false);
  });

  it('rejette un mauvais token (comparaison à temps constant)', () => {
    const guard = new RadiusInternalGuard(configWith(TOKEN));
    expect(
      guard.canActivate(ctxFor({ ip: '127.0.0.1', headers: { 'x-radius-token': 'wrong' } })),
    ).toBe(false);
  });

  it('rejette une longueur de token différente sans lever', () => {
    const guard = new RadiusInternalGuard(configWith(TOKEN));
    expect(
      guard.canActivate(ctxFor({ ip: '127.0.0.1', headers: { 'x-radius-token': `${TOKEN}extra` } })),
    ).toBe(false);
  });

  it('fail-closed quand aucun token n’est configuré', () => {
    const guard = new RadiusInternalGuard(configWith(''));
    expect(
      guard.canActivate(ctxFor({ ip: '127.0.0.1', headers: { 'x-radius-token': '' } })),
    ).toBe(false);
  });

  it('rejette une requête loopback sans en-tête token', () => {
    const guard = new RadiusInternalGuard(configWith(TOKEN));
    expect(guard.canActivate(ctxFor({ ip: '127.0.0.1', headers: {} }))).toBe(false);
  });
});
