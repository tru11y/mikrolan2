import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
} from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { TenantContext } from '../../common/context/tenant-context';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { SubscriptionsService } from './subscriptions.service';
import {
  activateSchema,
  requestUpgradeSchema,
  type ActivateDto,
  type RequestUpgradeDto,
} from './dto/subscription.schemas';

@Controller('subscriptions')
export class SubscriptionsController {
  constructor(private readonly subs: SubscriptionsService) {}

  @Get('me')
  me(@CurrentUser() user: TenantContext) {
    return this.subs.getForTenant(user.tenantId);
  }

  @Post('request-upgrade')
  @Roles(UserRole.OWNER)
  @HttpCode(200)
  requestUpgrade(
    @CurrentUser() user: TenantContext,
    @Body(new ZodValidationPipe(requestUpgradeSchema)) dto: RequestUpgradeDto,
  ) {
    return this.subs.requestUpgrade(user.tenantId, user.userId, dto.note);
  }

  // ── Platform admin (manual validation) ──────────────────
  @Post(':tenantId/activate')
  @Roles(UserRole.SUPER_ADMIN)
  @HttpCode(200)
  activate(
    @CurrentUser() actor: TenantContext,
    @Param('tenantId', ParseUUIDPipe) tenantId: string,
    @Body(new ZodValidationPipe(activateSchema)) dto: ActivateDto,
  ) {
    return this.subs.activate(
      tenantId,
      actor.userId,
      dto.periodDays,
      dto.invoiceId,
    );
  }

  @Post(':tenantId/deactivate')
  @Roles(UserRole.SUPER_ADMIN)
  @HttpCode(200)
  deactivate(
    @CurrentUser() actor: TenantContext,
    @Param('tenantId', ParseUUIDPipe) tenantId: string,
  ) {
    return this.subs.deactivate(tenantId, actor.userId);
  }
}
