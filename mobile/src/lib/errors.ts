import axios from 'axios';
import NetInfo from '@react-native-community/netinfo';

export type FieldErrors = Record<string, string>;

export interface DescribedError {
  message: string;
  retryable: boolean;
  errorCode: string | null;
  context: Record<string, unknown>;
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
    if (!(issue.path in out)) out[issue.path] = translateIssue(issue.message);
  }
  return out;
}

const ERROR_CODE_MESSAGES: Record<string, string> = {
  ROUTER_AUTH_FAILED: 'Authentification RouterOS échouée. Vérifiez les identifiants du routeur.',
  ROUTER_UNREACHABLE: 'Routeur injoignable. Vérifiez la connexion WireGuard.',
  ROUTER_REBOOT_FAILED: 'Le redémarrage du routeur a échoué.',
  ROUTER_LIMIT_REACHED: 'Limite de routeurs atteinte. Passez à une formule supérieure.',
  ROUTER_CREDS_MISSING: 'Identifiants du routeur manquants.',
  ROUTER_CREDS_INVALID: 'Identifiants du routeur invalides.',
  VOUCHER_LIMIT_REACHED: 'Limite de tickets/mois atteinte. Passez à une formule supérieure.',
  VOUCHER_PUSH_FAILED: 'Certains tickets n\'ont pas pu être envoyés au routeur.',
  VOUCHER_REVOKE_ROUTER_UNREACHABLE: 'Ticket révoqué en base, mais le routeur est injoignable.',
  VOUCHER_DELETE_ROUTER_UNREACHABLE: 'Ticket supprimé en base, mais le routeur est injoignable.',
  USER_LIMIT_REACHED: 'Limite d\'utilisateurs atteinte. Passez à une formule supérieure.',
};

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
      | { message?: string; error?: unknown; issues?: unknown; errorCode?: string; context?: Record<string, unknown> }
      | undefined;
    const fieldErrors = readIssues(body?.issues ?? body?.error);
    const errorCode = body?.errorCode ?? null;
    const context = body?.context ?? {};

    if (errorCode && ERROR_CODE_MESSAGES[errorCode]) {
      return {
        message: ERROR_CODE_MESSAGES[errorCode],
        retryable: status !== null && status >= 500,
        errorCode,
        context,
        fieldErrors,
        status,
      };
    }

    if (error.code === 'ECONNABORTED') {
      return {
        message: 'La connexion a expiré. Réessayez.',
        retryable: true,
        errorCode: 'TIMEOUT',
        context,
        fieldErrors: {},
        status,
      };
    }
    if (error.code === 'ERR_NETWORK' || status === null) {
      const netState = NetInfo.fetch();
      void netState.then((state) => {
        // async — for logging only, message already dispatched
        if (!state.isConnected) {
          // could update UI but describeError is sync-first
        }
      });
      return {
        message: 'Pas de connexion au serveur. Vérifiez votre réseau.',
        retryable: true,
        errorCode: 'NETWORK_ERROR',
        context,
        fieldErrors: {},
        status,
      };
    }

    const known = BY_STATUS[status];
    const serverMessage =
      body?.message && body.message !== 'Validation failed' ? body.message : null;

    return {
      message:
        serverMessage ??
        known?.message ??
        `Une erreur est survenue (code ${status}).`,
      retryable: known?.retryable ?? status >= 500,
      errorCode,
      context,
      fieldErrors,
      status,
    };
  }

  if (error instanceof Error && error.message) {
    return { message: error.message, retryable: false, errorCode: null, context: {}, fieldErrors: {}, status: null };
  }
  return {
    message: 'Une erreur inattendue est survenue.',
    retryable: true,
    errorCode: null,
    context: {},
    fieldErrors: {},
    status: null,
  };
}

/** Raccourci pour les endroits qui n'affichent qu'une phrase. */
export function errorMessage(error: unknown): string {
  return describeError(error).message;
}
