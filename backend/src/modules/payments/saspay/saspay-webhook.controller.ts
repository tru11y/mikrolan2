import {
  Controller,
  HttpStatus,
  Logger,
  Post,
  Req,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { FastifyRequest } from 'fastify';
import { Public } from '../../../common/decorators/public.decorator';
import { BusinessException } from '../../../common/exceptions/business.exception';
import { ErrorCode } from '../../../common/error-codes';
import type { AppConfig } from '../../../config/configuration';
import {
  SASPAY_EVENT_HEADER,
  SASPAY_SIGNATURE_HEADER,
  SASPAY_TIMESTAMP_HEADER,
  hashSaspayEvent,
  verifySaspayWebhook,
} from './saspay-signature';
import { saspayWebhookEventSchema } from './dto/webhook.dto';
import { SaspayService } from './saspay.service';

/**
 * Endpoint public : SasPay y pousse les events signés HMAC. Protégé :
 *  1. @Public() → bypass JWT global guard
 *  2. Vérification HMAC + anti-replay (±5 min)
 *  3. Dédup persistée côté service
 *  4. Doit répondre 2xx en moins de 15 s (budget SasPay) sinon retry
 */
@Controller('payments/saspay')
export class SaspayWebhookController {
  private readonly logger = new Logger(SaspayWebhookController.name);

  constructor(
    private readonly config: ConfigService<AppConfig, true>,
    private readonly service: SaspayService,
  ) {}

  @Post('webhook')
  @Public()
  async receive(@Req() req: FastifyRequest): Promise<{ received: true }> {
    const secret = this.config.get('SASPAY_WEBHOOK_SECRET', { infer: true });
    const sig = this.headerString(req.headers[SASPAY_SIGNATURE_HEADER]);
    const ts = this.headerString(req.headers[SASPAY_TIMESTAMP_HEADER]);
    const eventHeader = this.headerString(req.headers[SASPAY_EVENT_HEADER]);

    // On lit le raw body attaché par le hook Fastify (voir main.ts).
    const rawBody = (req as FastifyRequest & { rawBody?: string }).rawBody;
    if (typeof rawBody !== 'string') {
      // Absence de rawBody = défaut de configuration serveur, pas une
      // signature invalide. On préfère un 500 pour que SasPay retente.
      this.logger.error('SasPay webhook received without rawBody — check main.ts hook');
      throw new BusinessException(
        HttpStatus.INTERNAL_SERVER_ERROR,
        ErrorCode.PAYMENT_PROVIDER_UNAVAILABLE,
        'Configuration serveur invalide.',
      );
    }

    const verdict = verifySaspayWebhook({
      rawBody,
      signatureHeader: sig,
      timestampHeader: ts,
      secret,
    });

    if (!verdict.ok) {
      // Pas de détail au client (ne pas aider un attaquant), mais un log
      // explicite côté serveur et Sentry.
      this.logger.warn(
        `SasPay webhook rejected (event=${eventHeader ?? '?'} reason=${verdict.reason})`,
      );
      throw new BusinessException(
        HttpStatus.UNAUTHORIZED,
        ErrorCode.PAYMENT_SIGNATURE_INVALID,
        'Signature invalide.',
      );
    }

    const json = this.parseJsonSafe(rawBody);
    const parsed = saspayWebhookEventSchema.safeParse(json);
    if (!parsed.success) {
      this.logger.warn(`SasPay webhook payload invalid: ${parsed.error.message}`);
      // 200 OK quand même : la payload est signée par SasPay, donc une
      // forme imprévue est leur problème, pas le nôtre. Les retentatives
      // ne la rendront pas plus parsable.
      return { received: true };
    }

    const eventHash = hashSaspayEvent(ts!, sig!);
    await this.service.handleWebhookEvent(parsed.data, eventHash);
    return { received: true };
  }

  private headerString(v: unknown): string | undefined {
    if (typeof v === 'string') return v;
    if (Array.isArray(v) && typeof v[0] === 'string') return v[0];
    return undefined;
  }

  private parseJsonSafe(raw: string): unknown {
    try {
      return JSON.parse(raw);
    } catch {
      return null;
    }
  }
}
