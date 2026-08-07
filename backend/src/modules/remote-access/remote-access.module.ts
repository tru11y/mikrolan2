import { Module } from '@nestjs/common';
import { RemoteAccessController } from './remote-access.controller';
import { RemoteAccessService } from './remote-access.service';
import { RemoteRouterService } from './remote-router.service';
import { WireGuardService } from '../../common/wireguard/wireguard.service';
import { WireGuardReconciler } from './wireguard-reconciler.service';
import { SubscriptionsModule } from '../subscriptions/subscriptions.module';

@Module({
  imports: [SubscriptionsModule],
  controllers: [RemoteAccessController],
  providers: [
    RemoteAccessService,
    RemoteRouterService,
    WireGuardService,
    WireGuardReconciler,
  ],
  exports: [RemoteRouterService],
})
export class RemoteAccessModule {}
