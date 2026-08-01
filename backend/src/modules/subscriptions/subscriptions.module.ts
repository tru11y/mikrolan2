import { Module } from '@nestjs/common';
import { SubscriptionsController } from './subscriptions.controller';
import { SubscriptionsService } from './subscriptions.service';
import { TiersService } from './tiers.service';

@Module({
  controllers: [SubscriptionsController],
  providers: [SubscriptionsService, TiersService],
  exports: [SubscriptionsService, TiersService],
})
export class SubscriptionsModule {}
