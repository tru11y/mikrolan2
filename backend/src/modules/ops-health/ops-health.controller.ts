import { Controller, Get, UseInterceptors } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { AlwaysAllowed } from '../../common/decorators/always-allowed.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { AdminBypassInterceptor } from '../../common/interceptors/admin-bypass.interceptor';
import { OpsHealthService } from './ops-health.service';
import { WgAlertHealthService } from './wg-alert-health';
import { AuthEventsService } from '../auth/auth-events.service';
import { RuntimeHealthService } from './runtime-health';

@Controller('admin/system-health')
@Roles(UserRole.SUPER_ADMIN)
@AlwaysAllowed()
@UseInterceptors(AdminBypassInterceptor)
export class OpsHealthController {
  constructor(
    private readonly health: OpsHealthService,
    private readonly wgAlerts: WgAlertHealthService,
    private readonly authEvents: AuthEventsService,
    private readonly runtime: RuntimeHealthService,
  ) {}

  @Get()
  async get() {
    const [expiry, routers, wgAlerts, authSessions] = await Promise.all([
      this.health.getExpiryHealth(),
      this.health.getRoutersHealth(),
      this.wgAlerts.snapshot(),
      this.authEvents.metrics(),
    ]);
    return { expiry, routers, wgAlerts, authSessions, runtime: this.runtime.snapshot() };
  }
}
