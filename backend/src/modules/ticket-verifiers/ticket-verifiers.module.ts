import { Module } from '@nestjs/common';
import { TicketVerifiersController } from './ticket-verifiers.controller';
import { TicketVerifiersService } from './ticket-verifiers.service';

@Module({
  controllers: [TicketVerifiersController],
  providers: [TicketVerifiersService],
})
export class TicketVerifiersModule {}
