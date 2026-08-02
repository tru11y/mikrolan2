import { Controller, MessageEvent, Query, Req, Sse } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';
import { AlwaysAllowed } from '../../common/decorators/always-allowed.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { NoEnvelope } from '../../common/decorators/no-envelope.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { TenantContext } from '../../common/context/tenant-context';
import { EventsService } from './events.service';
import { LiveEvent, PLATFORM_CHANNEL } from './events.types';

/**
 * Curseur de reprise.
 *
 * Le paramètre de requête **prime** sur l'en-tête `Last-Event-ID`, contre
 * l'usage habituel : NestJS écrit sa propre numérotation dans la ligne `id:`
 * du flux (un battement de cœur émis sans id ressort quand même en « id: 1 »),
 * et un client qui renverrait cette valeur demanderait à reprendre au mauvais
 * endroit. Nos clients renvoient l'identifiant porté par la charge utile, qui
 * est celui du canal. L'en-tête reste accepté pour les clients qui n'ont que
 * lui.
 */
function readLastEventId(
  headerValue: string | string[] | undefined,
  queryValue: string | undefined,
): number | undefined {
  const header = Array.isArray(headerValue) ? headerValue[0] : headerValue;
  const raw = queryValue ?? header;
  if (!raw) return undefined;
  const parsed = Number.parseInt(raw, 10);
  return Number.isNaN(parsed) || parsed < 0 ? undefined : parsed;
}

function toMessage(event: LiveEvent): MessageEvent {
  return {
    // Le battement ne porte pas d'id : le reprendre ferait reculer le curseur
    // de reprise du client.
    id: event.id >= 0 ? String(event.id) : undefined,
    type: event.type,
    data: event,
    retry: 5000,
  };
}

@Controller('events')
export class EventsController {
  constructor(private readonly events: EventsService) {}

  /**
   * Flux du compte connecté. Accessible même quand l'essai est expiré : c'est
   * par là que le client apprend que son paiement a été validé.
   */
  @Sse('stream')
  @NoEnvelope()
  @AlwaysAllowed()
  stream(
    @CurrentUser() user: TenantContext,
    @Req() req: { headers: Record<string, string | string[] | undefined> },
    @Query('lastEventId') lastEventId?: string,
  ): Observable<MessageEvent> {
    const from = readLastEventId(req.headers['last-event-id'], lastEventId);
    return this.events.stream(user.tenantId, from).pipe(map(toMessage));
  }

  /** Flux de la plateforme : demandes d'activation, incidents. */
  @Sse('platform')
  @NoEnvelope()
  @Roles(UserRole.SUPER_ADMIN)
  platform(
    @Req() req: { headers: Record<string, string | string[] | undefined> },
    @Query('lastEventId') lastEventId?: string,
  ): Observable<MessageEvent> {
    const from = readLastEventId(req.headers['last-event-id'], lastEventId);
    return this.events.stream(PLATFORM_CHANNEL, from).pipe(map(toMessage));
  }
}
