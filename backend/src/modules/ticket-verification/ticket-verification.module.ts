import { Module } from '@nestjs/common';
import { TicketVerificationController } from './ticket-verification.controller';
import { TicketVerificationService } from './ticket-verification.service';
import { TicketVerifierScopeGuard } from '../../common/guards/ticket-verifier-scope.guard';

@Module({
  controllers: [TicketVerificationController],
  providers: [TicketVerificationService, TicketVerifierScopeGuard],
})
export class TicketVerificationModule {}
