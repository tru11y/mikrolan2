import { Module } from '@nestjs/common';
import { RemoteAccessController } from './remote-access.controller';
import { RemoteAccessService } from './remote-access.service';
import { WireGuardService } from '../../common/wireguard/wireguard.service';
import { SubscriptionsModule } from '../subscriptions/subscriptions.module';

@Module({
  imports: [SubscriptionsModule],
  controllers: [RemoteAccessController],
  providers: [RemoteAccessService, WireGuardService],
})
export class RemoteAccessModule {}
