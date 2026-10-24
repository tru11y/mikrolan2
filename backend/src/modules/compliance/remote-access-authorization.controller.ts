import { Body, Controller, Get, HttpCode, Post } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { z } from 'zod';
import { AlwaysAllowed } from '../../common/decorators/always-allowed.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { TenantContext } from '../../common/context/tenant-context';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { RemoteAccessAuthorizationService } from './remote-access-authorization.service';

const acceptSchema = z.object({ version: z.string().min(1).max(32) }).strict();
type AcceptDto = z.infer<typeof acceptSchema>;

// Révoquer doit rester possible même abonnement expiré : d'où AlwaysAllowed.
@Controller('remote-access/authorization')
@AlwaysAllowed()
export class RemoteAccessAuthorizationController {
  constructor(private readonly authorization: RemoteAccessAuthorizationService) {}

  @Get()
  status(@CurrentUser() user: TenantContext) {
    return this.authorization.status(user.tenantId);
  }

  @Post('accept')
  @Roles(UserRole.OWNER)
  @HttpCode(200)
  accept(
    @CurrentUser() user: TenantContext,
    @Body(new ZodValidationPipe(acceptSchema)) dto: AcceptDto,
  ) {
    return this.authorization.accept(user.tenantId, user.userId, dto.version);
  }

  @Post('revoke')
  @Roles(UserRole.OWNER)
  @HttpCode(200)
  revoke(@CurrentUser() user: TenantContext) {
    return this.authorization.revoke(user.tenantId, user.userId);
  }
}
