import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { Observable, Subject, concat, from, merge, timer } from 'rxjs';
import { finalize, map } from 'rxjs/operators';
import { LiveEvent, LiveEventType, PLATFORM_CHANNEL } from './events.types';

/**
 * Bus d'évènements temps réel, en mémoire.
 *
 * Remplace le sondage : l'application interrogeait `/notifications` toutes les
 * cinq secondes pour découvrir qu'un ticket venait d'être activé, ce qui fait
 * vingt requêtes par seconde à cent comptes actifs pour des évènements rares.
 *
 * Portée assumée : **un seul processus**. Les abonnés d'une instance ne voient
 * que les évènements publiés par cette instance. C'est exact tant que l'API
 * tourne dans un conteneur unique, ce qui est le cas en production. Passer à
 * plusieurs répliques impose de remplacer le `Subject` par un pub/sub Redis —
 * seul ce fichier changerait.
 */

/** Évènements conservés par canal pour la reprise via `Last-Event-ID`. */
const REPLAY_SIZE = 100;

/** Sans trafic, un proxy coupe une connexion SSE inactive. */
const HEARTBEAT_MS = 20_000;

/** Un canal sans abonné ni activité récente ne mérite plus de mémoire. */
const CHANNEL_TTL_MS = 15 * 60_000;
const SWEEP_MS = 5 * 60_000;

interface Channel {
  subject: Subject<LiveEvent>;
  buffer: LiveEvent[];
  nextId: number;
  subscribers: number;
  lastActivity: number;
}

@Injectable()
export class EventsService implements OnModuleDestroy {
  private readonly logger = new Logger(EventsService.name);
  private readonly channels = new Map<string, Channel>();
  private readonly sweeper: ReturnType<typeof setInterval>;

  constructor() {
    this.sweeper = setInterval(() => this.sweep(), SWEEP_MS);
    // Un timer de ménage ne doit pas retenir le processus à l'arrêt.
    this.sweeper.unref?.();
  }

  onModuleDestroy(): void {
    clearInterval(this.sweeper);
    for (const channel of this.channels.values()) channel.subject.complete();
    this.channels.clear();
  }

  /**
   * Publie sur le canal d'un tenant. Ne lève jamais : un évènement perdu ne
   * doit pas faire échouer l'opération métier qui l'a déclenché.
   */
  publish(
    channelId: string,
    event: Omit<LiveEvent, 'id' | 'at'> & { at?: string },
  ): void {
    try {
      const channel = this.channel(channelId);
      const full: LiveEvent = {
        ...event,
        id: channel.nextId++,
        at: event.at ?? new Date().toISOString(),
      };
      channel.buffer.push(full);
      if (channel.buffer.length > REPLAY_SIZE) channel.buffer.shift();
      channel.lastActivity = Date.now();
      channel.subject.next(full);
    } catch (error) {
      this.logger.warn(`Publication impossible sur ${channelId}: ${String(error)}`);
    }
  }

  /** Notifie la plateforme (demandes d'activation, incidents). */
  publishPlatform(event: Omit<LiveEvent, 'id' | 'at'>): void {
    this.publish(PLATFORM_CHANNEL, event);
  }

  /**
   * Flux d'un canal : d'abord ce qui a été manqué depuis `lastEventId`, puis
   * le direct, plus un battement régulier pour tenir la connexion ouverte.
   */
  stream(channelId: string, lastEventId?: number): Observable<LiveEvent> {
    const channel = this.channel(channelId);
    channel.subscribers += 1;

    const missed =
      lastEventId === undefined
        ? []
        : channel.buffer.filter((e) => e.id > lastEventId);

    const heartbeat = timer(HEARTBEAT_MS, HEARTBEAT_MS).pipe(
      map<number, LiveEvent>(() => ({
        id: -1,
        type: 'HEARTBEAT' as LiveEventType,
        at: new Date().toISOString(),
        title: '',
        body: '',
        data: {},
      })),
    );

    return concat(from(missed), merge(channel.subject, heartbeat)).pipe(
      finalize(() => {
        channel.subscribers = Math.max(0, channel.subscribers - 1);
        channel.lastActivity = Date.now();
      }),
    );
  }

  private channel(id: string): Channel {
    let channel = this.channels.get(id);
    if (!channel) {
      channel = {
        subject: new Subject<LiveEvent>(),
        buffer: [],
        nextId: 1,
        subscribers: 0,
        lastActivity: Date.now(),
      };
      this.channels.set(id, channel);
    }
    return channel;
  }

  private sweep(): void {
    const cutoff = Date.now() - CHANNEL_TTL_MS;
    for (const [id, channel] of this.channels) {
      if (channel.subscribers === 0 && channel.lastActivity < cutoff) {
        channel.subject.complete();
        this.channels.delete(id);
      }
    }
  }
}
