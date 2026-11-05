import { Controller, Get, UseInterceptors } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { AlwaysAllowed } from '../../common/decorators/always-allowed.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { AdminBypassInterceptor } from '../../common/interceptors/admin-bypass.interceptor';
import { OpsHealthService } from './ops-health.service';

@Controller('admin/system-health')
@Roles(UserRole.SUPER_ADMIN)
@AlwaysAllowed()
@UseInterceptors(AdminBypassInterceptor)
export class OpsHealthController {
  constructor(private readonly health: OpsHealthService) {}

  @Get()
  async get() {
    return { expiry: await this.health.getExpiryHealth() };
  }
}
