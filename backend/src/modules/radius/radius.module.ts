import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { EventsModule } from '../events/events.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { CryptoModule } from '../../common/crypto/crypto.module';
import { RemoteAccessModule } from '../remote-access/remote-access.module';
import { RadiusController } from './radius.controller';
import { RouterLinkController } from './router-link.controller';
import { RadiusService } from './radius.service';
import { RadiusCoaService } from './radius-coa.service';
import { RadiusInternalGuard } from './guards/radius-internal.guard';
import { RadiusSessionCron } from './radius-session.cron';
import { RouterLinkService } from './router-link.service';

/**
 * Module RADIUS (PR5 : câblé dans AppModule). Expose le CRUD des liens
 * (RouterLinkController, JWT + @Roles(ADMIN)) et les endpoints internes
 * /internal/radius/* (RadiusController, protégé loopback + X-Radius-Token via
 * RadiusInternalGuard, fail-closed si RADIUS_INTERNAL_TOKEN vide). Le
 * comportement prod RADIUS reste gaté par RADIUS_ENABLED : le cron de sessions
 * est inerte tant qu'il est false, et l'activation d'un lien est refusée
 * (RADIUS_DISABLED). Sans FreeRADIUS, tout reste testable en REST direct.
 */
@Module({
  imports: [PrismaModule, EventsModule, NotificationsModule, CryptoModule, RemoteAccessModule],
  controllers: [RadiusController, RouterLinkController],
  providers: [RadiusService, RadiusCoaService, RadiusInternalGuard, RadiusSessionCron, RouterLinkService],
  exports: [RouterLinkService],
})
export class RadiusModule {}
