import {
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
import { RemoteAccessService } from './remote-access.service';
import { RemoteRouterService } from './remote-router.service';

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
  ) {
    return this.remote.provision(id, user.userId);
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
