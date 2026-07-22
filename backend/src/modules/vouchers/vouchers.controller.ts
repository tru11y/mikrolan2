import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
} from '@nestjs/common';
import { UserRole, VoucherStatus } from '@prisma/client';
import { Roles } from '../../common/decorators/roles.decorator';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { VoucherService } from './voucher.service';
import {
  generateVouchersSchema,
  type GenerateVouchersDto,
} from './dto/voucher.schemas';

@Controller('routers/:id/vouchers')
export class VouchersController {
  constructor(private readonly vouchers: VoucherService) {}

  @Post('generate')
  @Roles(UserRole.ADMIN)
  @HttpCode(200)
  generate(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(generateVouchersSchema)) dto: GenerateVouchersDto,
  ) {
    return this.vouchers.generate(id, dto);
  }

  @Get()
  list(
    @Param('id', ParseUUIDPipe) id: string,
    @Query('status') status?: string,
    @Query('batchId') batchId?: string,
  ) {
    const s = this.asStatus(status);
    return this.vouchers.list(id, s, batchId);
  }

  @Get('batches')
  batches(@Param('id', ParseUUIDPipe) id: string) {
    return this.vouchers.listBatches(id);
  }

  @Post(':voucherId/revoke')
  @Roles(UserRole.ADMIN)
  @HttpCode(200)
  revoke(@Param('voucherId', ParseUUIDPipe) voucherId: string) {
    return this.vouchers.revoke(voucherId);
  }

  private asStatus(value?: string): VoucherStatus | undefined {
    return value && value in VoucherStatus
      ? (value as VoucherStatus)
      : undefined;
  }
}
