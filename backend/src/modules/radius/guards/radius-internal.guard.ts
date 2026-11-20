import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { timingSafeEqual } from 'node:crypto';
import type { FastifyRequest } from 'fastify';
import type { AppConfig } from '../../../config/configuration';

const TOKEN_HEADER = 'x-radius-token';

/**
 * `main.ts` configure `trustProxy: '127.0.0.1'` : seul un pair direct en
 * loopback peut imposer `req.ip` via X-Forwarded-For. FreeRADIUS (rlm_rest)
 * parle à l'API en loopback sans en-tête de proxy → `req.ip` reste une adresse
 * loopback. `::ffff:127.0.0.1` couvre la forme IPv4-mapped de la pile duale.
 */
const LOOPBACK = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);

/**
 * Garde par secret partagé pour les endpoints internes `/internal/radius/*`
 * (modèle saspay-webhook + verifier-throttler). Fail-closed, deux contrôles
 * cumulatifs : (a) la requête vient de la loopback ; (b) l'en-tête
 * `X-Radius-Token` égale `RADIUS_INTERNAL_TOKEN` (comparaison à temps constant).
 * `CanActivate` au niveau classe — PAS un APP_GUARD.
 */
@Injectable()
export class RadiusInternalGuard implements CanActivate {
  constructor(private readonly config: ConfigService<AppConfig, true>) {}

  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<FastifyRequest>();
    if (!LOOPBACK.has(req.ip)) return false;

    const expected = this.config.get('RADIUS_INTERNAL_TOKEN', { infer: true });
    if (!expected) return false; // fail-closed : aucun secret configuré

    const provided = headerString(req.headers[TOKEN_HEADER]);
    if (provided === undefined) return false;

    return safeEqual(provided, expected);
  }
}

function headerString(value: unknown): string | undefined {
  if (typeof value === 'string') return value;
  if (Array.isArray(value) && typeof value[0] === 'string') return value[0];
  return undefined;
}

function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  // timingSafeEqual exige des longueurs égales ; la différence de longueur est
  // le seul canal toléré (comme tout HMAC de longueur fixe).
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}
