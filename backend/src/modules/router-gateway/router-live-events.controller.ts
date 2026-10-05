import { Controller, MessageEvent, NotFoundException, Param, ParseUUIDPipe, Sse } from '@nestjs/common';
import { defer, finalize, type Observable } from 'rxjs';
import { PrismaService } from '../../prisma/prisma.service';
import { NoEnvelope } from '../../common/decorators/no-envelope.decorator';
import { RouterLiveEventsService } from './router-live-events.service';
import { RouterGatewayService } from './router-gateway.service';

/**
 * Flux temps réel éphémère (§8 du cadrage) : `ROUTER_STATS`, `SESSION_COUNT_CHANGED`,
 * `SESSIONS_CHANGED`, `ROUTER_LIVE_STALE`, `ROUTER_LIVE_RECOVERED`. Distinct du
 * canal `events/stream` (notifications métier persistées) — aucun curseur de
 * reprise : une reconnexion redemande simplement un snapshot via `GET .../live`.
 */
@Controller('routers/:id/live-events')
export class RouterLiveEventsController {
  constructor(
    private readonly liveEvents: RouterLiveEventsService,
    private readonly prisma: PrismaService,
    private readonly gateway: RouterGatewayService,
  ) {}

  @Sse()
  @NoEnvelope()
  async stream(@Param('id', ParseUUIDPipe) id: string): Promise<Observable<MessageEvent>> {
    // Le middleware Prisma scope automatiquement par tenant : un id d'un autre
    // tenant ne matche jamais, ce qui évite qu'un client abonné apprenne l'état
    // d'un routeur qui n'est pas le sien.
    const router = await this.prisma.router.findFirst({ where: { id, deletedAt: null }, select: { id: true } });
    if (!router) throw new NotFoundException('Routeur introuvable');
    // Un abonné SSE = un écran ouvert : le collecteur accélère la cadence HOT tant qu'il y en a.
    return defer(() => {
      const release = this.gateway.watch(id);
      return this.liveEvents.stream(id).pipe(finalize(release));
    });
  }
}
