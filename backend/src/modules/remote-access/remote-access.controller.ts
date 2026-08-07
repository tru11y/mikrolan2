import {
  Body,
  Controller,
  Get,
  HttpCode,
  Optional,
  Param,
  ParseUUIDPipe,
  Post,
} from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { z } from 'zod';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { TenantContext } from '../../common/context/tenant-context';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { RemoteAccessService } from './remote-access.service';
import { RemoteRouterService } from './remote-router.service';

// Operators sometimes move RouterOS management services off their default
// ports (most commonly `www` from 80 → 87 for hardening). The mobile app
// probes the router's `/ip service` right before provisioning and hands the
// observed ports to the backend so the VPS DNAT targets a listening port.
const provisionSchema = z
  .object({
    webfigPort: z.coerce.number().int().min(1).max(65535).optional(),
    sshPort: z.coerce.number().int().min(1).max(65535).optional(),
    winboxPort: z.coerce.number().int().min(1).max(65535).optional(),
  })
  .default({});
type ProvisionDto = z.infer<typeof provisionSchema>;

@Controller('routers/:id/remote')
export class RemoteAccessController {
  constructor(
    private readonly remote: RemoteAccessService,
    private readonly remoteRouter: RemoteRouterService,
  ) {}

  @Get()
  status(@Param('id', ParseUUIDPipe) id: string) {
    return this.remote.status(id);
  }

  @Get('system-resource')
  systemResource(@Param('id', ParseUUIDPipe) id: string) {
    return this.remoteRouter.systemResource(id);
  }

  @Post('provision')
  @Roles(UserRole.ADMIN)
  @HttpCode(200)
  provision(
    @CurrentUser() user: TenantContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Optional()
    @Body(new ZodValidationPipe(provisionSchema))
    dto: ProvisionDto = {},
  ) {
    return this.remote.provision(id, user.userId, dto);
  }

  @Post('revoke')
  @Roles(UserRole.ADMIN)
  @HttpCode(200)
  revoke(
    @CurrentUser() user: TenantContext,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.remote.revoke(id, user.userId);
  }

  @Post('reboot')
  @Roles(UserRole.ADMIN)
  @HttpCode(200)
  async reboot(@Param('id', ParseUUIDPipe) id: string) {
    await this.remoteRouter.reboot(id);
    return { rebooted: true };
  }
}
