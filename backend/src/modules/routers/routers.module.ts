import { Module } from '@nestjs/common';
import { RoutersController } from './routers.controller';
import { RoutersService } from './routers.service';
import { SubscriptionsModule } from '../subscriptions/subscriptions.module';
import { WireGuardService } from '../../common/wireguard/wireguard.service';

@Module({
  imports: [SubscriptionsModule],
  controllers: [RoutersController],
  providers: [RoutersService, WireGuardService],
})
export class RoutersModule {}
