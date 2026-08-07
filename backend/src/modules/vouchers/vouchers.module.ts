import { Module } from '@nestjs/common';
import { VouchersController } from './vouchers.controller';
import { VoucherService } from './voucher.service';
import { RemoteAccessModule } from '../remote-access/remote-access.module';

@Module({
  imports: [RemoteAccessModule],
  controllers: [VouchersController],
  providers: [VoucherService],
})
export class VouchersModule {}
