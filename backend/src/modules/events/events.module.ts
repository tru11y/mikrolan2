import { Global, Module } from '@nestjs/common';
import { EventsController } from './events.controller';
import { EventsService } from './events.service';

/**
 * Global : n'importe quel service métier doit pouvoir publier un évènement
 * sans que chaque module ait à réimporter celui-ci — l'alternative était de
 * faire remonter le bus par injection dans huit modules.
 */
@Global()
@Module({
  controllers: [EventsController],
  providers: [EventsService],
  exports: [EventsService],
})
export class EventsModule {}
