import { Controller, MessageEvent, NotFoundException, Param, ParseUUIDPipe, Sse } from '@nestjs/common';
import type { Observable } from 'rxjs';
import { PrismaService } from '../../prisma/prisma.service';
import { NoEnvelope } from '../../common/decorators/no-envelope.decorator';
import { RouterLiveEventsService } from './router-live-events.service';

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
  ) {}

  @Sse()
  @NoEnvelope()
  async stream(@Param('id', ParseUUIDPipe) id: string): Promise<Observable<MessageEvent>> {
    // Le middleware Prisma scope automatiquement par tenant : un id d'un autre
    // tenant ne matche jamais, ce qui évite qu'un client abonné apprenne l'état
    // d'un routeur qui n'est pas le sien.
    const router = await this.prisma.router.findFirst({ where: { id, deletedAt: null }, select: { id: true } });
    if (!router) throw new NotFoundException('Routeur introuvable');
    return this.liveEvents.stream(id);
  }
}
