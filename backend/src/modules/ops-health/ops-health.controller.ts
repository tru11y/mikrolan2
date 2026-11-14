import { Controller, Get, UseInterceptors } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { AlwaysAllowed } from '../../common/decorators/always-allowed.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { AdminBypassInterceptor } from '../../common/interceptors/admin-bypass.interceptor';
import { OpsHealthService } from './ops-health.service';
import { WgAlertHealthService } from './wg-alert-health';

@Controller('admin/system-health')
@Roles(UserRole.SUPER_ADMIN)
@AlwaysAllowed()
@UseInterceptors(AdminBypassInterceptor)
export class OpsHealthController {
  constructor(
    private readonly health: OpsHealthService,
    private readonly wgAlerts: WgAlertHealthService,
  ) {}

  @Get()
  async get() {
    const [expiry, routers, wgAlerts] = await Promise.all([
      this.health.getExpiryHealth(),
      this.health.getRoutersHealth(),
      this.wgAlerts.snapshot(),
    ]);
    return { expiry, routers, wgAlerts };
  }
}
