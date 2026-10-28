import {
  Body,
  Controller,
  Get,
  HttpStatus,
  Param,
  Post,
  UsePipes,
} from '@nestjs/common';
import { AlwaysAllowed } from '../../../common/decorators/always-allowed.decorator';
import { ZodValidationPipe } from '../../../common/pipes/zod-validation.pipe';
import { getTenantContext } from '../../../common/context/tenant-context';
import { BusinessException } from '../../../common/exceptions/business.exception';
import { ErrorCode } from '../../../common/error-codes';
import { createCheckoutSchema, type CreateCheckoutDto } from './dto/checkout.dto';
import { SaspayService } from './saspay.service';

function requireTenantContext() {
  const ctx = getTenantContext();
  if (!ctx) {
    throw new BusinessException(
      HttpStatus.UNAUTHORIZED,
      ErrorCode.TENANT_CONTEXT_MISSING,
      'Session invalide.',
    );
  }
  return ctx;
}

@Controller('payments/saspay')
export class SaspayController {
  constructor(private readonly service: SaspayService) {}

  /**
   * Un client paywall-lock DOIT pouvoir atteindre cette route — c'est
   * littéralement sa seule issue : payer pour débloquer. On la marque
   * donc `AlwaysAllowed`, à l'image du flux legacy "upload-proof".
   */
  @Post('checkout')
  @AlwaysAllowed()
  @UsePipes(new ZodValidationPipe(createCheckoutSchema))
  async createCheckout(@Body() dto: CreateCheckoutDto) {
    const ctx = requireTenantContext();
    return this.service.createCheckout(ctx.tenantId, ctx.userId, dto);
  }

  @Get('intents/:id')
  @AlwaysAllowed()
  async getIntent(@Param('id') id: string) {
    const ctx = requireTenantContext();
    return this.service.getIntentStatus(ctx.tenantId, id);
  }
}
