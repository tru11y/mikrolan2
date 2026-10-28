import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { PrismaModule } from '../../../prisma/prisma.module';
import { SubscriptionsModule } from '../../subscriptions/subscriptions.module';
import { SaspayClient } from './saspay.client';
import { SaspayController } from './saspay.controller';
import { SaspayService } from './saspay.service';
import { SaspayWebhookController } from './saspay-webhook.controller';

@Module({
  imports: [ConfigModule, PrismaModule, SubscriptionsModule],
  controllers: [SaspayController, SaspayWebhookController],
  providers: [SaspayClient, SaspayService],
  exports: [SaspayService],
})
export class SaspayModule {}
