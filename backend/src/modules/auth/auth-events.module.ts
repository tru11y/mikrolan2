import { Module } from '@nestjs/common';
import { AuthEventsService } from './auth-events.service';

@Module({
  providers: [AuthEventsService],
  exports: [AuthEventsService],
})
export class AuthEventsModule {}
