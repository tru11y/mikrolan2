import { NotificationType } from '@prisma/client';

/** Canal réservé à la plateforme : seuls les SUPER_ADMIN s'y abonnent. */
export const PLATFORM_CHANNEL = 'platform';

export type LiveEventType = NotificationType | 'HEARTBEAT';

export interface LiveEvent {
  /** Monotone par canal. Sert de `Last-Event-ID` pour la reprise. */
  id: number;
  type: LiveEventType;
  at: string;
  title: string;
  body: string;
  /** Charge utile libre (ids voucher/routeur/tenant selon le type). */
  data: Record<string, string | number | null>;
}
