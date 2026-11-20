import { Body, Controller, HttpCode, Logger, Post, UseGuards } from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import { Public } from '../../common/decorators/public.decorator';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { RadiusInternalGuard } from './guards/radius-internal.guard';
import { RadiusService } from './radius.service';
import {
  accountingSchema,
  authorizeSchema,
  type AuthorizeDto,
  type AuthorizeResponse,
} from './dto/radius.schemas';

/**
 * Endpoints internes consommés par FreeRADIUS (rlm_rest). `@Public()` contourne
 * le JwtAuthGuard global ; la sécurité repose sur `RadiusInternalGuard`
 * (loopback + secret partagé). `@SkipThrottle()` : le trafic RADIUS est déjà
 * borné par le NAS et ne doit pas tomber sous le quota par IP.
 */
@Controller('internal/radius')
@Public()
@SkipThrottle()
@UseGuards(RadiusInternalGuard)
export class RadiusController {
  private readonly logger = new Logger(RadiusController.name);

  constructor(private readonly service: RadiusService) {}

  @Post('authorize')
  @HttpCode(200)
  authorize(
    @Body(new ZodValidationPipe(authorizeSchema)) dto: AuthorizeDto,
  ): Promise<AuthorizeResponse> {
    return this.service.authorize(dto);
  }

  /**
   * Répond TOUJOURS 200, même sur payload inattendu ou erreur de mapping (comme
   * saspay-webhook) : un 4xx ferait retenter le NAS à l'infini. On logge et on
   * absorbe.
   */
  @Post('accounting')
  @HttpCode(200)
  async accounting(@Body() body: unknown): Promise<{ status: 'ok' }> {
    const parsed = accountingSchema.safeParse(body);
    if (!parsed.success) {
      this.logger.warn(`accounting payload invalide: ${parsed.error.message}`);
      return { status: 'ok' };
    }
    try {
      await this.service.accounting(parsed.data);
    } catch (err) {
      this.logger.error(`accounting échec de traitement: ${(err as Error).message}`);
    }
    return { status: 'ok' };
  }
}
