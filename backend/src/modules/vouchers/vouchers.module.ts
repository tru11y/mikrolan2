import { Module } from '@nestjs/common';
import { VouchersController } from './vouchers.controller';
import { VouchersGlobalController } from './vouchers-global.controller';
import { VoucherService } from './voucher.service';
import { RemoteAccessModule } from '../remote-access/remote-access.module';
import { SubscriptionsModule } from '../subscriptions/subscriptions.module';

@Module({
  imports: [RemoteAccessModule, SubscriptionsModule],
  controllers: [VouchersController, VouchersGlobalController],
  providers: [VoucherService],
})
export class VouchersModule {}
