import { Module } from '@nestjs/common';
import { VouchersController } from './vouchers.controller';
import { VouchersGlobalController } from './vouchers-global.controller';
import { VoucherService } from './voucher.service';
import { RemoteAccessModule } from '../remote-access/remote-access.module';

@Module({
  imports: [RemoteAccessModule],
  controllers: [VouchersController, VouchersGlobalController],
  providers: [VoucherService],
})
export class VouchersModule {}
