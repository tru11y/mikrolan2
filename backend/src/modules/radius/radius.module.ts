import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { EventsModule } from '../events/events.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { RadiusController } from './radius.controller';
import { RadiusService } from './radius.service';
import { RadiusCoaService } from './radius-coa.service';
import { RadiusInternalGuard } from './guards/radius-internal.guard';
import { RadiusSessionCron } from './radius-session.cron';

/**
 * Module RADIUS « dark » : NON importé par app.module.ts tant qu'il n'est pas
 * validé. Entièrement testable en REST direct sur /internal/radius/* (sans vrai
 * FreeRADIUS). Son activation consiste à l'ajouter aux imports de AppModule et à
 * configurer RADIUS_INTERNAL_TOKEN.
 */
@Module({
  imports: [PrismaModule, EventsModule, NotificationsModule],
  controllers: [RadiusController],
  providers: [RadiusService, RadiusCoaService, RadiusInternalGuard, RadiusSessionCron],
})
export class RadiusModule {}
