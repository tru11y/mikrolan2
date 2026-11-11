import { Module } from '@nestjs/common';
import { OpsHealthAlertCron } from './ops-health.alert.cron';
import { OpsHealthController } from './ops-health.controller';
import { OpsHealthService } from './ops-health.service';
import { WgStaleAlertService } from './wg-stale-alert.service';
import { RemoteAccessModule } from '../remote-access/remote-access.module';
import { NotificationsModule } from '../notifications/notifications.module';

@Module({
  imports: [RemoteAccessModule, NotificationsModule],
  controllers: [OpsHealthController],
  providers: [OpsHealthService, OpsHealthAlertCron, WgStaleAlertService],
})
export class OpsHealthModule {}
