import { Controller, Get, UseInterceptors } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { AlwaysAllowed } from '../../common/decorators/always-allowed.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { AdminBypassInterceptor } from '../../common/interceptors/admin-bypass.interceptor';
import { OpsHealthService } from './ops-health.service';
import { WgAlertDeliveryRegistry } from './wg-alert-delivery';
import { AuthEventsService } from '../auth/auth-events.service';
import { RuntimeHealthService } from './runtime-health';

@Controller('admin/system-health')
@Roles(UserRole.SUPER_ADMIN)
@AlwaysAllowed()
@UseInterceptors(AdminBypassInterceptor)
export class OpsHealthController {
  constructor(
    private readonly health: OpsHealthService,
    private readonly wgAlerts: WgAlertDeliveryRegistry,
    private readonly authEvents: AuthEventsService,
    private readonly runtime: RuntimeHealthService,
  ) {}

  @Get()
  async get() {
    const [expiry, routers, authSessions] = await Promise.all([
      this.health.getExpiryHealth(),
      this.health.getRoutersHealth(),
      this.authEvents.metrics(),
    ]);
    return { expiry, routers, wgAlerts: this.wgAlerts.snapshot(), authSessions, runtime: this.runtime.snapshot() };
  }
}
