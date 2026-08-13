import {
  Body,
  Controller,
  Delete,
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
  confirmVouchersSchema,
  generateVouchersSchema,
  type ConfirmVouchersDto,
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

  @Post('confirm')
  @Roles(UserRole.ADMIN)
  @HttpCode(200)
  confirm(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(confirmVouchersSchema)) dto: ConfirmVouchersDto,
  ) {
    return this.vouchers.confirmPush(id, dto);
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

  // Point lookup by code — used at the counter to verify a ticket without
  // depending on the recent-only `list()` cap. Must stay above `:voucherId`
  // routes so "lookup" isn't parsed as a voucher id.
  @Get('lookup')
  lookup(
    @Param('id', ParseUUIDPipe) id: string,
    @Query('code') code: string,
  ) {
    return this.vouchers.lookupByCode(id, (code ?? '').trim());
  }

  @Delete('batches/:batchId')
  @Roles(UserRole.ADMIN)
  removeBatch(@Param('batchId', ParseUUIDPipe) batchId: string) {
    return this.vouchers.removeBatch(batchId);
  }

  @Post(':voucherId/revoke')
  @Roles(UserRole.ADMIN)
  @HttpCode(200)
  revoke(@Param('voucherId', ParseUUIDPipe) voucherId: string) {
    return this.vouchers.revoke(voucherId);
  }

  @Delete(':voucherId')
  @Roles(UserRole.ADMIN)
  remove(@Param('voucherId', ParseUUIDPipe) voucherId: string) {
    return this.vouchers.remove(voucherId);
  }

  private asStatus(value?: string): VoucherStatus | undefined {
    return value && value in VoucherStatus
      ? (value as VoucherStatus)
      : undefined;
  }
}
