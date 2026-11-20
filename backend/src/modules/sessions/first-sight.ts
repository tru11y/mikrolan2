import { NotificationType, VoucherStatus } from '@prisma/client';
import type { PrismaService } from '../../prisma/prisma.service';
import type { EventsService } from '../events/events.service';
import type { NotificationsService } from '../notifications/notifications.service';

/**
 * Dépendances minimales partagées entre `SessionsService.reconcileActive`
 * (chemin RouterOS) et `RadiusService.accounting` (chemin FreeRADIUS). Les deux
 * convergent vers le MÊME point d'écriture de revenu : la promotion atomique
 * GENERATED→ACTIVE et la notification VOUCHER_ACTIVATED ne sont écrites qu'ici.
 */
export interface FirstSightDeps {
  prisma: PrismaService;
  events: EventsService;
  notifications: NotificationsService;
}

export interface FirstSightArgs {
  voucherId: string;
  code: string;
  /** Lu uniquement depuis Plan.priceXof côté serveur, jamais fourni par le client. */
  planPriceXof: number;
  routerId: string;
  tenantId: string;
  now: Date;
  logger?: { warn: (message: string) => void };
}

/**
 * Première détection d'une connexion : promotion conditionnelle atomique du
 * voucher GENERATED→ACTIVE, snapshot de revenu figé une seule fois (jamais
 * recalculé si Plan.priceXof change ensuite — audit/51, audit/52), puis
 * notification VOUCHER_ACTIVATED (persistée + évènement live + push).
 *
 * Retourne `true` si CET appel a gagné la promotion (et a donc émis la
 * notification), `false` si un autre tick/compte a déjà promu le voucher (course
 * optimiste) — l'appelant ne doit alors PAS ouvrir de session. N'écrit JAMAIS la
 * Session : chaque appelant la persiste à sa façon (create vs upsert RADIUS).
 */
export async function firstSightActivation(
  deps: FirstSightDeps,
  args: FirstSightArgs,
): Promise<boolean> {
  const price = args.planPriceXof;
  const priceValid = Number.isInteger(price) && price > 0;
  if (!priceValid) {
    args.logger?.warn(
      'Activation avec prix de forfait non exploitable — snapshot non écrit (priceSnapshotSource=UNKNOWN).',
    );
  }

  const promoted = await deps.prisma.voucher.updateMany({
    where: { id: args.voucherId, status: VoucherStatus.GENERATED },
    data: {
      status: VoucherStatus.ACTIVE,
      usedAt: args.now,
      priceXofAtActivation: priceValid ? price : null,
      priceSnapshotSource: priceValid ? 'EXACT' : 'UNKNOWN',
    },
  });
  if (promoted.count === 0) return false; // un autre tick/compte est arrivé avant

  const title = 'Ticket activé';
  const body = `Le ticket ${args.code} vient de se connecter au hotspot.`;
  const notification = await deps.prisma.notification.create({
    data: {
      tenantId: args.tenantId,
      type: NotificationType.VOUCHER_ACTIVATED,
      title,
      body,
      voucherId: args.voucherId,
      routerId: args.routerId,
    },
  });
  // La notification est l'historique ; l'évènement est l'immédiat ; le push
  // couvre l'opérateur hors ligne au moment précis de la connexion.
  deps.events.publish(args.tenantId, {
    type: NotificationType.VOUCHER_ACTIVATED,
    title,
    body,
    data: {
      notificationId: notification.id,
      voucherId: args.voucherId,
      routerId: args.routerId,
      code: args.code,
    },
  });
  deps.notifications.sendPushToTenant(args.tenantId, title, body, args.routerId, {
    notificationId: notification.id,
    type: NotificationType.VOUCHER_ACTIVATED,
  });
  return true;
}
