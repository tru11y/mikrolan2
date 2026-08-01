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

/** `Last-Event-ID` est un en-tête standard ; certains clients ne peuvent pas
 *  le poser (EventSource natif le fait, `fetch` polyfillé non), d'où le
 *  paramètre de requête en repli. */
function readLastEventId(
  headerValue: string | string[] | undefined,
  queryValue: string | undefined,
): number | undefined {
  const raw = Array.isArray(headerValue) ? headerValue[0] : (headerValue ?? queryValue);
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
