import {
  Body,
  Controller,
  HttpCode,
  Post,
  UseGuards,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { UserRole } from '@prisma/client';
import { Roles } from '../../common/decorators/roles.decorator';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { TicketVerifierScopeGuard } from '../../common/guards/ticket-verifier-scope.guard';
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
@UseGuards(TicketVerifierScopeGuard)
export class TicketVerificationController {
  constructor(private readonly svc: TicketVerificationService) {}

  @Post('verify')
  @HttpCode(200)
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  verify(
    @VerifierScope() scope: TicketVerifierScope,
    @Body(new ZodValidationPipe(verifyTicketSchema)) dto: VerifyTicketDto,
  ) {
    return this.svc.verify(scope, dto.ticketCode);
  }
}
