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

@Controller('routers/:id/remote')
export class RemoteAccessController {
  constructor(private readonly remote: RemoteAccessService) {}

  @Get()
  status(@Param('id', ParseUUIDPipe) id: string) {
    return this.remote.status(id);
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
}
