import { Module } from '@nestjs/common';
import { SessionsController } from './sessions.controller';
import { SessionsService } from './sessions.service';
import { RemoteAccessModule } from '../remote-access/remote-access.module';
import { NotificationsModule } from '../notifications/notifications.module';

@Module({
  imports: [RemoteAccessModule, NotificationsModule],
  controllers: [SessionsController],
  providers: [SessionsService],
})
export class SessionsModule {}
