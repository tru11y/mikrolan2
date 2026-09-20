import { Global, Module } from '@nestjs/common';
import { EventsController } from './events.controller';
import { EventsService } from './events.service';
import { EventLogService } from './event-log.service';

@Global()
@Module({
  controllers: [EventsController],
  providers: [EventsService, EventLogService],
  exports: [EventsService, EventLogService],
})
export class EventsModule {}
