import { Module } from '@nestjs/common';
import { RemoteAccessController } from './remote-access.controller';
import { RemoteAccessService } from './remote-access.service';
import { RemoteRouterService } from './remote-router.service';
import { WireGuardService } from '../../common/wireguard/wireguard.service';
import { WireGuardReconciler } from './wireguard-reconciler.service';
import { SubscriptionsModule } from '../subscriptions/subscriptions.module';
import { RemoteTunnelService } from './tunnel/remote-tunnel.service';
import { RemoteTunnelGateway } from './tunnel/remote-tunnel.gateway';
import { TunnelRegistryModule } from './tunnel/tunnel-registry.module';

@Module({
  // TunnelRegistryModule est @Global : une seule instance de registre partagée
  // par tous les modules qui coupent des sessions tunnel vivantes.
  imports: [SubscriptionsModule, TunnelRegistryModule],
  controllers: [RemoteAccessController],
  providers: [
    RemoteAccessService,
    RemoteRouterService,
    WireGuardService,
    WireGuardReconciler,
    RemoteTunnelService,
    RemoteTunnelGateway,
  ],
  exports: [
    RemoteRouterService,
    WireGuardService,
    RemoteTunnelService,
    RemoteTunnelGateway,
  ],
})
export class RemoteAccessModule {}
