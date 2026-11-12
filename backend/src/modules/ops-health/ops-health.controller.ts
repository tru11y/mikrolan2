import { Controller, Get, UseInterceptors } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { AlwaysAllowed } from '../../common/decorators/always-allowed.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { AdminBypassInterceptor } from '../../common/interceptors/admin-bypass.interceptor';
import { OpsHealthService } from './ops-health.service';
import { WgAlertDeliveryRegistry } from './wg-alert-delivery';

@Controller('admin/system-health')
@Roles(UserRole.SUPER_ADMIN)
@AlwaysAllowed()
@UseInterceptors(AdminBypassInterceptor)
export class OpsHealthController {
  constructor(
    private readonly health: OpsHealthService,
    private readonly wgAlerts: WgAlertDeliveryRegistry,
  ) {}

  @Get()
  async get() {
    const [expiry, routers] = await Promise.all([
      this.health.getExpiryHealth(),
      this.health.getRoutersHealth(),
    ]);
    return { expiry, routers, wgAlerts: this.wgAlerts.snapshot() };
  }
}
