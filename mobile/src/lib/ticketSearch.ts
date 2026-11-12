import type { VoucherStatus } from '@/src/lib/api';

/**
 * Comportement de la requête paginée de « Voir les tickets » (propre à cet écran, le QueryClient global n'est pas modifié).
 * - `maxPages` : au plus 10 pages (300 tickets) en cache ; au-delà, les plus anciennes pages sont retirées.
 * - un rafraîchissement d'une requête paginée rejoue TOUTES les pages en cache : on supprime les rafraîchissements
 *   automatiques au retour dans l'app et à la reconnexion (staleTime de 5 min pour le reste).
 */
export const LOT_TICKETS_QUERY = {
  maxPages: 10,
  staleTime: 5 * 60_000,
  refetchOnWindowFocus: false,
  refetchOnReconnect: false,
} as const;

/** Libellé d'état affiché dans la liste des tickets d'un lot. */
export const TICKET_STATUS_LABEL: Record<VoucherStatus, string> = {
  GENERATED: 'Disponible',
  ACTIVE: 'En cours',
  USED: 'Utilisé',
  EXPIRED: 'Expiré',
  REVOKED: 'Annulé',
};

export type TicketTone = 'success' | 'warning' | 'danger' | 'muted';

export const TICKET_STATUS_TONE: Record<VoucherStatus, TicketTone> = {
  GENERATED: 'success',
  ACTIVE: 'warning',
  USED: 'muted',
  EXPIRED: 'muted',
  REVOKED: 'danger',
};

function formatDuration(minutes: number): string {
  if (minutes % 1440 === 0) {
    const d = minutes / 1440;
    return d === 1 ? '1 jour' : `${d} jours`;
  }
  if (minutes % 60 === 0) return `${minutes / 60} h`;
  return `${minutes} min`;
}

/** Texte prêt à envoyer par WhatsApp/SMS : code, forfait, durée, prix. Jamais d'identifiant de ticket interne. */
export function ticketShareText(t: { code: string; planName: string; durationMinutes: number; priceXof: number }): string {
  return [
    `Votre ticket WiFi : ${t.code}`,
    `Forfait : ${t.planName} (${formatDuration(t.durationMinutes)})`,
    `Prix : ${t.priceXof} FCFA`,
    'Saisissez ce code sur la page de connexion du WiFi.',
  ].join('\n');
}

/** Une recherche n'est lancée qu'à partir de 2 caractères (le serveur refuse moins). */
export function normalizeSearch(raw: string): string | undefined {
  const q = raw.trim();
  return q.length >= 2 ? q : undefined;
}

/** Fusionne les pages en retirant les doublons (même ticket reçu deux fois), l'ordre serveur est conservé. */
export function mergePages<T extends { id: string }>(pages: { items: T[] }[]): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const page of pages) {
    for (const item of page.items) {
      if (!seen.has(item.id)) {
        seen.add(item.id);
        out.push(item);
      }
    }
  }
  return out;
}
