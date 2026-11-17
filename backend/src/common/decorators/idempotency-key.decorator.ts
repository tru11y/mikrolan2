import { createParamDecorator, ExecutionContext, HttpStatus } from '@nestjs/common';
import { BusinessException } from '../exceptions/business.exception';
import { ErrorCode } from '../error-codes';

// UUID v4 strict. Format imposé pour que le client utilise un générateur sûr
// (randomUUID / uuid v4), pas un identifiant arbitraire.
export const UUID_V4_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export const IDEMPOTENCY_KEY_MAX_LENGTH = 64;

/**
 * Logique d'extraction isolée pour être testée sans ExecutionContext réel.
 * Fastify normalise déjà les noms de headers en minuscules, donc on lit
 * exclusivement `idempotency-key`. Un header dupliqué est renvoyé par Fastify
 * sous la forme d'un tableau (ou, selon la version, d'une chaîne séparée par
 * virgules contenant une virgule) : toute forme non scalaire est rejetée pour
 * ne jamais accepter silencieusement deux valeurs conflictuelles.
 */
export function extractIdempotencyKey(
  headers: Record<string, string | string[] | undefined> | undefined,
): string | undefined {
  const raw = headers?.['idempotency-key'];
  if (raw === undefined || raw === null) return undefined;
  if (Array.isArray(raw)) {
    throw new BusinessException(
      HttpStatus.BAD_REQUEST,
      ErrorCode.IDEMPOTENCY_KEY_INVALID,
      'Idempotency-Key reçu plusieurs fois dans la même requête.',
    );
  }
  if (typeof raw !== 'string') {
    throw new BusinessException(
      HttpStatus.BAD_REQUEST,
      ErrorCode.IDEMPOTENCY_KEY_INVALID,
      'Idempotency-Key doit être une valeur textuelle unique.',
    );
  }
  const trimmed = raw.trim();
  if (trimmed.length === 0) return undefined;
  // Fastify concatène parfois deux valeurs du même header avec ", " : refuser.
  if (trimmed.includes(',')) {
    throw new BusinessException(
      HttpStatus.BAD_REQUEST,
      ErrorCode.IDEMPOTENCY_KEY_INVALID,
      'Idempotency-Key ne doit contenir qu\'une seule valeur.',
    );
  }
  if (trimmed.length > IDEMPOTENCY_KEY_MAX_LENGTH || !UUID_V4_REGEX.test(trimmed)) {
    throw new BusinessException(
      HttpStatus.BAD_REQUEST,
      ErrorCode.IDEMPOTENCY_KEY_INVALID,
      'Idempotency-Key doit être un UUID v4.',
    );
  }
  return trimmed;
}

/**
 * Lit le header HTTP `Idempotency-Key` et renvoie l'UUID v4 validé, ou
 * `undefined` si le header est absent. La clé reste optionnelle (compat
 * anciens APK). Un header présent mais malformé/dupliqué est rejeté avant
 * toute écriture par une exception métier 400 `IDEMPOTENCY_KEY_INVALID`.
 *
 * Volontairement local : utilisé uniquement par POST /vouchers/generate.
 */
export const IdempotencyKey = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): string | undefined => {
    const req = ctx.switchToHttp().getRequest<{ headers?: Record<string, string | string[] | undefined> }>();
    return extractIdempotencyKey(req.headers);
  },
);
