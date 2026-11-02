import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import type { TicketVerifierScope } from '../guards/ticket-verifier-scope.guard';

/**
 * Reads the scope injected by TicketVerifierScopeGuard on the request.
 * Only valid downstream of that guard; never used to receive data from
 * the client.
 */
export const VerifierScope = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): TicketVerifierScope | undefined => {
    const req = ctx
      .switchToHttp()
      .getRequest<{ verifierScope?: TicketVerifierScope }>();
    return req.verifierScope;
  },
);
