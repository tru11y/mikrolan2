import { Module } from '@nestjs/common';
import { SessionsController } from './sessions.controller';
import { SessionsService } from './sessions.service';
import { SessionCleanupCron } from './session-cleanup.cron';
import { RemoteAccessModule } from '../remote-access/remote-access.module';
import { NotificationsModule } from '../notifications/notifications.module';

@Module({
  imports: [RemoteAccessModule, NotificationsModule],
  controllers: [SessionsController],
  providers: [SessionsService, SessionCleanupCron],
})
export class SessionsModule {}
