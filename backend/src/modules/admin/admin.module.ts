import { Module } from '@nestjs/common';
import { SubscriptionsModule } from '../subscriptions/subscriptions.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { RemoteAccessModule } from '../remote-access/remote-access.module';
import { AdminController } from './admin.controller';
import { AdminService } from './admin.service';

@Module({
  imports: [SubscriptionsModule, NotificationsModule, RemoteAccessModule],
  controllers: [AdminController],
  providers: [AdminService],
})
export class AdminModule {}
