import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Req,
  Res,
} from '@nestjs/common';
import { BusinessException } from '../../common/exceptions/business.exception';
import { ErrorCode } from '../../common/error-codes';
import { UserRole, VoucherStatus } from '@prisma/client';
import { FastifyReply, FastifyRequest } from 'fastify';
import { Roles } from '../../common/decorators/roles.decorator';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { TenantContext } from '../../common/context/tenant-context';
import { VoucherService } from './voucher.service';
import { TicketVaultService } from './ticket-vault.service';
import {
  confirmVouchersSchema,
  generateVouchersSchema,
  type ConfirmVouchersDto,
  type GenerateVouchersDto,
} from './dto/voucher.schemas';

@Controller('routers/:id/vouchers')
export class VouchersController {
  constructor(
    private readonly vouchers: VoucherService,
    private readonly vault: TicketVaultService,
  ) {}

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

  @Post('batches/:batchId/vault')
  @Roles(UserRole.ADMIN)
  @HttpCode(201)
  async uploadBatchPdf(
    @CurrentUser() user: TenantContext,
    @Param('batchId', ParseUUIDPipe) batchId: string,
    @Req() req: FastifyRequest,
  ) {
    const data = await req.file();
    if (!data) throw new BusinessException(HttpStatus.BAD_REQUEST, ErrorCode.FILE_REQUIRED, 'Fichier PDF requis.');
    if (data.mimetype !== 'application/pdf') {
      throw new BusinessException(HttpStatus.BAD_REQUEST, ErrorCode.FILE_TYPE_UNSUPPORTED, 'Seuls les fichiers PDF sont acceptés.');
    }
    const buffer = await data.toBuffer();
    if (buffer.length > 10 * 1024 * 1024) {
      throw new BusinessException(HttpStatus.BAD_REQUEST, ErrorCode.FILE_TOO_LARGE, 'Le fichier ne doit pas dépasser 10 Mo.');
    }
    return this.vault.store(user.tenantId, batchId, buffer, data.filename);
  }

  @Get('batches/:batchId/vault')
  listBatchPdfs(@Param('batchId', ParseUUIDPipe) batchId: string) {
    return this.vault.listByBatch(batchId);
  }

  @Get('vault/:vaultId')
  async downloadPdf(
    @CurrentUser() user: TenantContext,
    @Param('vaultId', ParseUUIDPipe) vaultId: string,
    @Res({ passthrough: true }) res: FastifyReply,
  ) {
    const file = await this.vault.download(vaultId, user.tenantId);
    res.header('Content-Type', 'application/pdf');
    res.header('Content-Disposition', `attachment; filename="${file.fileName}"`);
    return file;
  }

  private asStatus(value?: string): VoucherStatus | undefined {
    return value && value in VoucherStatus
      ? (value as VoucherStatus)
      : undefined;
  }
}
