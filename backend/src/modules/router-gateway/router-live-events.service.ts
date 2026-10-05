import { Injectable, type MessageEvent } from '@nestjs/common';
import { merge, Observable, Subject, timer } from 'rxjs';
import { filter, map } from 'rxjs/operators';

import type { LiveSession, RouterLiveSnapshot } from './router-gateway.types';

const HEARTBEAT_MS = 20_000;

/**
 * Canal temps réel éphémère, séparé des « Business Notifications » (§8 du
 * cadrage) : ces événements décrivent un état RouterOS instantané, jamais un
 * fait métier à relire après coup. Ils ne passent donc PAS par `NotificationType`
 * (enum Prisma) ni par `EventsService` — aucune migration, aucune persistance,
 * aucun curseur de reprise : un client qui se reconnecte redemande simplement
 * un snapshot via `GET .../live`.
 */
export type RouterLiveEvent =
  | { type: 'ROUTER_STATS'; routerId: string; snapshot: RouterLiveSnapshot }
  | { type: 'SESSION_COUNT_CHANGED'; routerId: string; sessionCount: number }
  | { type: 'SESSIONS_CHANGED'; routerId: string; sessions: LiveSession[] }
  | { type: 'ROUTER_LIVE_STALE'; routerId: string; reason?: 'SLOW' | 'UNREACHABLE' }
  | { type: 'ROUTER_LIVE_RECOVERED'; routerId: string };

@Injectable()
export class RouterLiveEventsService {
  private readonly subject = new Subject<RouterLiveEvent>();

  emit(event: RouterLiveEvent): void {
    this.subject.next(event);
  }

  /**
   * Flux filtré sur un routeur, prêt pour `@Sse`, avec un battement de cœur
   * (un proxy coupe une connexion SSE inactive — même seuil que `EventsService`).
   */
  stream(routerId: string): Observable<MessageEvent> {
    const events = this.subject.asObservable().pipe(
      filter((e) => e.routerId === routerId),
      map((e) => ({ type: e.type, data: e }) satisfies MessageEvent),
    );
    const heartbeat = timer(HEARTBEAT_MS, HEARTBEAT_MS).pipe(
      map(() => ({ type: 'HEARTBEAT', data: { type: 'HEARTBEAT' as const, routerId } }) satisfies MessageEvent),
    );
    return merge(events, heartbeat);
  }
}
