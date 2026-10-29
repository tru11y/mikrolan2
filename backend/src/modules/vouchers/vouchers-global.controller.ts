import { Body, Controller, HttpCode, Post } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { UserRole } from '@prisma/client';
import { Roles } from '../../common/decorators/roles.decorator';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { VoucherService } from './voucher.service';
import {
  verifyVoucherSchema,
  type VerifyVoucherDto,
} from './dto/voucher.schemas';

@Controller('vouchers')
export class VouchersGlobalController {
  constructor(private readonly vouchers: VoucherService) {}

  // Endpoint historique opérateur (tenant). Refuse explicitement
  // TICKET_VERIFIER : ce rôle doit passer par POST /ticket-verification/verify
  // qui applique l'isolation hotspot stricte.
  @Post('verify')
  @HttpCode(200)
  @Roles(UserRole.MEMBER)
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  verify(
    @Body(new ZodValidationPipe(verifyVoucherSchema)) dto: VerifyVoucherDto,
  ) {
    return this.vouchers.verifyVoucherForOperator(dto);
  }
}
