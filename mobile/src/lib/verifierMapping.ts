// Mapping entre le status/action retournés par POST /ticket-verification/verify
// et le rendu visuel. Testé en isolation : évite tout .text ou any dans l'UI.
import type {
  TicketVerificationAction,
  TicketVerificationResponse,
  TicketVerificationStatus,
} from './api';

export type ToneKey = 'success' | 'warning' | 'danger' | 'muted' | 'primary';

export interface VerdictView {
  title: string;
  subtitle: string | null;
  tone: ToneKey;
  actionLabel: string;
}

/** Codes d'action stables → libellés FR affichables (jamais utilisés
 * comme logique métier, c'est le code `recommendedAction` qui pilote). */
export function actionLabel(a: TicketVerificationAction): string {
  switch (a) {
    case 'ALLOW_CUSTOMER':
      return 'Autoriser le client';
    case 'DO_NOT_REPLACE':
      return 'Ne pas remplacer le ticket';
    case 'SELL_NEW_TICKET':
      return 'Proposer un nouveau ticket';
    case 'RETRY_LATER':
      return 'Réessayer plus tard';
    case 'CHECK_ENTERED_CODE':
      return 'Vérifiez le code saisi';
  }
}

/** Mapping status → rendu (titre, tonalité, sous-message).
 * Les textes serveurs sont volontairement ignorés (jamais utilisés comme
 * source de vérité) ; on affiche des libellés FR locaux. */
export function verdictView(res: TicketVerificationResponse): VerdictView {
  const action = actionLabel(res.recommendedAction);
  switch (res.status) {
    case 'VALID':
      return {
        title: 'Ticket valide',
        subtitle: null,
        tone: 'success',
        actionLabel: action,
      };
    case 'ALREADY_USED':
      return {
        title: 'Ticket déjà utilisé',
        subtitle: null,
        tone: 'warning',
        actionLabel: action,
      };
    case 'EXPIRED':
      return {
        title: 'Ticket expiré',
        subtitle: null,
        tone: 'danger',
        actionLabel: action,
      };
    case 'NOT_FOUND':
      return {
        title: 'Ticket inexistant',
        subtitle: 'Vérifiez le code saisi.',
        tone: 'muted',
        actionLabel: action,
      };
    case 'TEMPORARILY_UNAVAILABLE':
      return {
        title: 'Vérification temporairement indisponible',
        subtitle: 'Réessayez dans quelques instants.',
        tone: 'primary',
        actionLabel: action,
      };
  }
}

/** Erreurs HTTP → tonalité et message utilisateur locaux.
 * Jamais la "raison" interne du guard, jamais le détail du 403. */
export interface HttpErrorView {
  title: string;
  subtitle: string;
  tone: ToneKey;
  // Si true, l'écran principal doit basculer en mode "bloqué" (ne plus
  // permettre la saisie).
  blocking: boolean;
}

export function httpErrorView(status: number | undefined): HttpErrorView {
  if (status === 400) {
    return {
      title: 'Code invalide',
      subtitle: 'Vérifiez le code saisi et réessayez.',
      tone: 'warning',
      blocking: false,
    };
  }
  if (status === 429) {
    return {
      title: 'Trop de vérifications',
      subtitle: 'Attendez un moment avant de réessayer.',
      tone: 'warning',
      blocking: false,
    };
  }
  if (status === 403) {
    return {
      title: 'Accès indisponible',
      subtitle: 'Votre accès à la vérification n\'est pas disponible. Contactez votre responsable.',
      tone: 'danger',
      blocking: true,
    };
  }
  // 401 handled upstream by the auth refresh interceptor; if it reaches here
  // it means refresh failed → the auth provider pushes to login.
  return {
    title: 'Vérification temporairement indisponible',
    subtitle: 'Vérifiez votre connexion et réessayez.',
    tone: 'primary',
    blocking: false,
  };
}

/** Validation locale alignée sur le DTO backend (trim-first + min 1 + max 64).
 * Ne modifie pas la casse (le backend fait un match insensible). */
export function normalizeTicketCode(raw: string): string {
  return raw.trim();
}

export function isValidLength(code: string): boolean {
  const t = normalizeTicketCode(code);
  return t.length > 0 && t.length <= 64;
}

/** Codes stables ou fallback pour UI exhaustive sans utiliser `any`. */
export const KNOWN_STATUSES: readonly TicketVerificationStatus[] = [
  'VALID',
  'ALREADY_USED',
  'EXPIRED',
  'NOT_FOUND',
  'TEMPORARILY_UNAVAILABLE',
] as const;
