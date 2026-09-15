import { Module } from '@nestjs/common';
import { SubscriptionsController } from './subscriptions.controller';
import { SubscriptionsService } from './subscriptions.service';
import { TiersService } from './tiers.service';
import { PaymentCron } from './payment.cron';
import { NotificationsModule } from '../notifications/notifications.module';

@Module({
  imports: [NotificationsModule],
  controllers: [SubscriptionsController],
  providers: [SubscriptionsService, TiersService, PaymentCron],
  exports: [SubscriptionsService, TiersService],
})
export class SubscriptionsModule {}
