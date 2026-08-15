import { Body, Controller, HttpCode, Post } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { VoucherService } from './voucher.service';
import {
  verifyVoucherSchema,
  type VerifyVoucherDto,
} from './dto/voucher.schemas';

@Controller('vouchers')
export class VouchersGlobalController {
  constructor(private readonly vouchers: VoucherService) {}

  @Post('verify')
  @HttpCode(200)
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  verify(
    @Body(new ZodValidationPipe(verifyVoucherSchema)) dto: VerifyVoucherDto,
  ) {
    return this.vouchers.verifyVoucherForOperator(dto);
  }
}
