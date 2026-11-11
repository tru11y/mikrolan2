/**
 * Nettoyage des données envoyées à Sentry côté app : aucun mot de passe, jeton, code de ticket
 * ni identifiant RouterOS dans un événement ou un fil d'Ariane. Fonctions pures, sans dépendance.
 */
const SENSITIVE_KEY = /pass(word)?|pwd|secret|token|authorization|cookie|api[-_]?key|credential|otp|mfa|code|cred/i;
const REDACTED = '[Filtré]';

export function scrubValue(value: unknown, depth = 0): unknown {
  if (depth > 6) return REDACTED;
  if (Array.isArray(value)) return value.map((v) => scrubValue(v, depth + 1));
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([k, v]) => [
        k,
        SENSITIVE_KEY.test(k) ? REDACTED : scrubValue(v, depth + 1),
      ]),
    );
  }
  return value;
}

export function scrubBreadcrumb<T extends { data?: Record<string, unknown> }>(breadcrumb: T): T {
  if (breadcrumb.data) breadcrumb.data = scrubValue(breadcrumb.data) as Record<string, unknown>;
  return breadcrumb;
}

type ScrubbableEvent = {
  request?: { data?: unknown; headers?: Record<string, unknown>; cookies?: unknown; query_string?: unknown };
  user?: { ip_address?: string | null; email?: string; username?: string };
  extra?: Record<string, unknown>;
  breadcrumbs?: { data?: Record<string, unknown> }[];
};

export function scrubEvent<T extends ScrubbableEvent>(event: T): T {
  if (event.request) {
    delete event.request.data;
    delete event.request.cookies;
    if (event.request.headers) event.request.headers = scrubValue(event.request.headers) as Record<string, unknown>;
    if (event.request.query_string) event.request.query_string = REDACTED;
  }
  if (event.user) {
    delete event.user.ip_address;
    delete event.user.email;
    delete event.user.username;
  }
  if (event.extra) event.extra = scrubValue(event.extra) as Record<string, unknown>;
  event.breadcrumbs?.forEach((b) => scrubBreadcrumb(b));
  return event;
}
