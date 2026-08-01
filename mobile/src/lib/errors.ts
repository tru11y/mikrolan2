import axios from 'axios';

/**
 * Traduction des pannes en quelque chose d'actionnable.
 *
 * L'app se contentait de recopier `error.message` dans un bandeau rouge :
 * l'utilisateur lisait « Request failed with status code 502 » ou
 * « Validation failed », sans savoir si c'était sa faute, s'il fallait
 * réessayer, ni quel champ corriger. Tout passe désormais par ici.
 */

export type FieldErrors = Record<string, string>;

export interface DescribedError {
  /** Phrase affichable, en français, qui dit quoi faire. */
  message: string;
  /** Vrai quand réessayer a une chance d'aboutir (réseau, 5xx, timeout). */
  retryable: boolean;
  /** Erreurs par champ renvoyées par la validation Zod du serveur. */
  fieldErrors: FieldErrors;
  status: number | null;
}

/** Messages Zod du backend (anglais, techniques) → français. */
function translateIssue(message: string): string {
  const m = message.toLowerCase();
  if (m.includes('required')) return 'Champ obligatoire.';
  if (m.includes('invalid email')) return 'Adresse e-mail invalide.';
  if (m.includes('greater than or equal') || m.includes('too small'))
    return 'Valeur trop petite.';
  if (m.includes('less than or equal') || m.includes('too big'))
    return 'Valeur trop grande.';
  if (m.includes('invalid')) return 'Valeur invalide.';
  return message;
}

function readIssues(payload: unknown): FieldErrors {
  if (!Array.isArray(payload)) return {};
  const out: FieldErrors = {};
  for (const raw of payload) {
    if (typeof raw !== 'object' || raw === null) continue;
    const issue = raw as { path?: unknown; message?: unknown };
    if (typeof issue.path !== 'string' || typeof issue.message !== 'string') continue;
    // Premier message par champ : les suivants répètent la même cause.
    if (!(issue.path in out)) out[issue.path] = translateIssue(issue.message);
  }
  return out;
}

const BY_STATUS: Record<number, { message: string; retryable: boolean }> = {
  400: { message: 'Certaines informations sont invalides.', retryable: false },
  401: { message: 'Session expirée. Reconnectez-vous.', retryable: false },
  403: {
    message: "Votre abonnement ne donne pas accès à cette fonction.",
    retryable: false,
  },
  404: { message: 'Élément introuvable — il a peut-être été supprimé.', retryable: false },
  409: { message: 'Cette opération est déjà en cours ou déjà faite.', retryable: false },
  413: { message: 'Fichier trop volumineux.', retryable: false },
  429: { message: 'Trop de tentatives. Patientez une minute.', retryable: true },
  500: { message: 'Le serveur a rencontré un problème.', retryable: true },
  502: { message: 'Serveur momentanément indisponible.', retryable: true },
  503: { message: 'Service en maintenance. Réessayez dans un instant.', retryable: true },
  504: { message: 'Le serveur met trop de temps à répondre.', retryable: true },
};

export function describeError(error: unknown): DescribedError {
  if (axios.isAxiosError(error)) {
    const status = error.response?.status ?? null;
    const body = error.response?.data as
      | { message?: string; error?: unknown }
      | undefined;
    const fieldErrors = readIssues(body?.error);

    if (error.code === 'ECONNABORTED') {
      return {
        message: 'Le serveur met trop de temps à répondre. Réessayez.',
        retryable: true,
        fieldErrors: {},
        status,
      };
    }
    if (error.code === 'ERR_NETWORK' || status === null) {
      return {
        message:
          'Serveur injoignable. Vérifiez votre connexion et l’adresse du serveur.',
        retryable: true,
        fieldErrors: {},
        status,
      };
    }

    const known = BY_STATUS[status];
    // Un message métier du backend ("Identifiants invalides") est plus précis
    // que notre générique — sauf le "Validation failed" de la pipe Zod, qui ne
    // veut rien dire pour l'utilisateur.
    const serverMessage =
      body?.message && body.message !== 'Validation failed' ? body.message : null;

    return {
      message:
        serverMessage ??
        known?.message ??
        `Une erreur est survenue (code ${status}).`,
      retryable: known?.retryable ?? status >= 500,
      fieldErrors,
      status,
    };
  }

  if (error instanceof Error && error.message) {
    return { message: error.message, retryable: false, fieldErrors: {}, status: null };
  }
  return {
    message: 'Une erreur inattendue est survenue.',
    retryable: true,
    fieldErrors: {},
    status: null,
  };
}

/** Raccourci pour les endroits qui n'affichent qu'une phrase. */
export function errorMessage(error: unknown): string {
  return describeError(error).message;
}
