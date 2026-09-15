import { Module } from '@nestjs/common';
import { RoutersController } from './routers.controller';
import { RoutersService } from './routers.service';
import { RouterHealthCron } from './router-health.cron';
import { SubscriptionsModule } from '../subscriptions/subscriptions.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { WireGuardService } from '../../common/wireguard/wireguard.service';

@Module({
  imports: [SubscriptionsModule, NotificationsModule],
  controllers: [RoutersController],
  providers: [RoutersService, RouterHealthCron, WireGuardService],
  exports: [RoutersService],
})
export class RoutersModule {}
