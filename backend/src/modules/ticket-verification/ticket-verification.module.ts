import { Module } from '@nestjs/common';
import { TicketVerificationController } from './ticket-verification.controller';
import { TicketVerificationService } from './ticket-verification.service';
import { TicketVerifierScopeGuard } from '../../common/guards/ticket-verifier-scope.guard';
import { VerifierThrottlerGuard } from '../../common/guards/verifier-throttler.guard';

@Module({
  controllers: [TicketVerificationController],
  providers: [
    TicketVerificationService,
    TicketVerifierScopeGuard,
    VerifierThrottlerGuard,
  ],
})
export class TicketVerificationModule {}
