import { Module } from '@nestjs/common';
import { TicketVerifiersController } from './ticket-verifiers.controller';
import { SubscriptionsModule } from '../subscriptions/subscriptions.module';
import { TicketVerifiersService } from './ticket-verifiers.service';

@Module({
  imports: [SubscriptionsModule],
  controllers: [TicketVerifiersController],
  providers: [TicketVerifiersService],
})
export class TicketVerifiersModule {}
