import { Module } from '@nestjs/common';
import { VouchersController } from './vouchers.controller';
import { VouchersGlobalController } from './vouchers-global.controller';
import { VoucherService } from './voucher.service';
import { TicketVaultService } from './ticket-vault.service';
import { RemoteAccessModule } from '../remote-access/remote-access.module';
import { SubscriptionsModule } from '../subscriptions/subscriptions.module';

@Module({
  imports: [RemoteAccessModule, SubscriptionsModule],
  controllers: [VouchersController, VouchersGlobalController],
  providers: [VoucherService, TicketVaultService],
  exports: [TicketVaultService],
})
export class VouchersModule {}
