import { Module } from '@nestjs/common';
import { OpsHealthAlertCron } from './ops-health.alert.cron';
import { OpsHealthController } from './ops-health.controller';
import { OpsHealthService } from './ops-health.service';
import { WgStaleAlertService } from './wg-stale-alert.service';
import { WgAlertEpisodeService } from './wg-alert-episode.service';
import { WgAlertHealthService } from './wg-alert-health';
import { RuntimeHealthService } from './runtime-health';
import { RemoteAccessModule } from '../remote-access/remote-access.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { AuthEventsModule } from '../auth/auth-events.module';

@Module({
  imports: [RemoteAccessModule, NotificationsModule, AuthEventsModule],
  controllers: [OpsHealthController],
  providers: [OpsHealthService, OpsHealthAlertCron, WgStaleAlertService, WgAlertEpisodeService, WgAlertHealthService, RuntimeHealthService],
})
export class OpsHealthModule {}
