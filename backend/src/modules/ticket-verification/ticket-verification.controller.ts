import {
  Body,
  Controller,
  HttpCode,
  Post,
  UseGuards,
} from '@nestjs/common';
import { SkipThrottle, Throttle } from '@nestjs/throttler';
import { UserRole } from '@prisma/client';
import { Roles } from '../../common/decorators/roles.decorator';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { TicketVerifierScopeGuard } from '../../common/guards/ticket-verifier-scope.guard';
import { VerifierThrottlerGuard } from '../../common/guards/verifier-throttler.guard';
import {
  VerifierScope,
} from '../../common/decorators/verifier-scope.decorator';
import type { TicketVerifierScope } from '../../common/guards/ticket-verifier-scope.guard';
import {
  verifyTicketSchema,
  type VerifyTicketDto,
} from './dto/verify-ticket.schema';
import { TicketVerificationService } from './ticket-verification.service';

@Controller('ticket-verification')
@Roles(UserRole.TICKET_VERIFIER)
// VerifierThrottlerGuard runs before TicketVerifierScopeGuard so a flood is
// stopped before touching the DB. Both are controller-level @UseGuards, so
// APP_GUARDs (Jwt → Roles → Entitlement) have already run and req.user is set.
@UseGuards(VerifierThrottlerGuard, TicketVerifierScopeGuard)
export class TicketVerificationController {
  constructor(private readonly svc: TicketVerificationService) {}

  @Post('verify')
  @HttpCode(200)
  // Disable the global ThrottlerGuard (keyed by IP) for this route so two
  // vendors sharing an uplink don't compete for the same quota. Our local
  // VerifierThrottlerGuard keys by userId and overrides shouldSkip() so this
  // decorator does NOT disable it.
  @SkipThrottle()
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  verify(
    @VerifierScope() scope: TicketVerifierScope,
    @Body(new ZodValidationPipe(verifyTicketSchema)) dto: VerifyTicketDto,
  ) {
    return this.svc.verify(scope, dto.ticketCode);
  }
}
