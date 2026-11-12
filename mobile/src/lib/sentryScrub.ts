/**
 * Nettoyage des données envoyées à Sentry côté app : aucun mot de passe, jeton, code de ticket,
 * identifiant RouterOS, e-mail, téléphone, IP, MAC ni clé WireGuard dans un événement ou un fil d'Ariane.
 * Fonctions pures, sans dépendance.
 */
const SENSITIVE_KEY =
  /pass(word)?|pwd|secret|token|authorization|cookie|api[-_]?key|credential|otp|mfa|code|cred|e-?mail|phone|t[eé]l|msisdn|mac(address)?$|^ip|ip_?address|private|public_?key|wg|saspay|proof|preuve|reference|username|^user$|query|(router|batch|voucher|plan|tenant|ticket|account|release)_?id$|routername|serial/i;
/** Clés techniques utiles dont le nom contient un motif sensible (ex. `status_code`). */
const SAFE_KEY = /^(status_?code|error_?code|http\.status_code)$/i;
const REDACTED = '[Filtré]';

const PATTERNS: [RegExp, string][] = [
  [/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, 'Bearer [Filtré]'],
  [/eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]*/g, '[jwt]'],
  [/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, '[email]'],
  [/\b(?:[0-9A-Fa-f]{2}[:-]){5}[0-9A-Fa-f]{2}\b/g, '[mac]'],
  [/\b(?:[0-9A-Fa-f]{1,4}:){7}[0-9A-Fa-f]{1,4}\b/g, '[ip]'],
  [/\b(?:[0-9A-Fa-f]{1,4}:){1,6}:(?:[0-9A-Fa-f]{1,4})?|::1\b/g, '[ip]'],
  [/\b(?:\d{1,3}\.){3}\d{1,3}\b/g, '[ip]'],
  [/\b[A-Za-z0-9+/]{43}=/g, '[clé]'],
  [/\+?\d[\d .-]{7,}\d/g, '[tel]'],
  [/([?&](?:code|token|password|pass|pwd|q|search|key|secret|voucher|username|user)=)[^&\s"']*/gi, '$1[Filtré]'],
];

export function scrubString(s: string): string {
  return PATTERNS.reduce((acc, [re, to]) => acc.replace(re, to), s);
}

function safeDecode(s: string): string {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}

/**
 * Route normalisée pour Sentry : chemin seul (ni hôte, ni query, ni fragment). Un segment n'est conservé
 * que s'il ressemble à un mot de route (minuscules et tirets, 20 car. max) ; tout le reste — UUID, CUID,
 * ULID, ObjectId, nombres, codes de ticket ou de lot — devient `:id`.
 */
export function normalizeRoute(url: string): string {
  const path = (url.split(/[?#]/)[0] ?? '').replace(/^[a-z][a-z0-9+.-]*:\/\/[^/]*/i, '');
  const segs = path.split('/').map((raw) => {
    const seg = safeDecode(raw);
    return seg === '' || /^[a-z][a-z-]{0,19}$/.test(seg) ? seg : ':id';
  });
  return segs.join('/') || '/';
}

export function scrubValue(value: unknown, depth = 0): unknown {
  if (depth > 6) return REDACTED;
  if (typeof value === 'string') return scrubString(value);
  if (Array.isArray(value)) return value.map((v) => scrubValue(v, depth + 1));
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([k, v]) => [
        k,
        SENSITIVE_KEY.test(k) && !SAFE_KEY.test(k) ? REDACTED : scrubValue(v, depth + 1),
      ]),
    );
  }
  return value;
}

type Crumb = { category?: string; message?: string; data?: Record<string, unknown> };

/** Réseau : liste blanche stricte (méthode, route normalisée, statut, durée). Le reste est nettoyé. */
export function scrubBreadcrumb<T extends Crumb>(breadcrumb: T): T {
  if (breadcrumb.category === 'xhr' || breadcrumb.category === 'fetch') {
    const d = breadcrumb.data ?? {};
    breadcrumb.data = {
      method: d.method,
      url: typeof d.url === 'string' ? normalizeRoute(d.url) : undefined,
      status_code: d.status_code,
      duration: d.duration,
    };
    return breadcrumb;
  }
  if (breadcrumb.message) breadcrumb.message = scrubString(breadcrumb.message);
  if (breadcrumb.data) breadcrumb.data = scrubValue(breadcrumb.data) as Record<string, unknown>;
  return breadcrumb;
}

type ScrubbableEvent = {
  message?: string;
  request?: { url?: string; data?: unknown; headers?: Record<string, unknown>; cookies?: unknown; query_string?: unknown };
  user?: Record<string, unknown>;
  extra?: Record<string, unknown>;
  tags?: Record<string, unknown>;
  contexts?: Record<string, unknown>;
  exception?: { values?: { value?: string }[] };
  breadcrumbs?: Crumb[];
};

export function scrubEvent<T extends ScrubbableEvent>(event: T): T {
  if (event.message) event.message = scrubString(event.message);
  if (event.request) {
    delete event.request.data;
    delete event.request.cookies;
    if (event.request.url) event.request.url = normalizeRoute(event.request.url);
    if (event.request.headers) event.request.headers = scrubValue(event.request.headers) as Record<string, unknown>;
    if (event.request.query_string) event.request.query_string = REDACTED;
  }
  if (event.user) event.user = {};
  if (event.extra) event.extra = scrubValue(event.extra) as Record<string, unknown>;
  if (event.tags) event.tags = scrubValue(event.tags) as Record<string, unknown>;
  if (event.contexts) event.contexts = scrubValue(event.contexts) as Record<string, unknown>;
  event.exception?.values?.forEach((v) => {
    if (v.value) v.value = scrubString(v.value);
  });
  event.breadcrumbs?.forEach((b) => scrubBreadcrumb(b));
  return event;
}

/** Réduction à l'émission : seules les valeurs numériques/booléennes sont gardées (jamais d'identifiant ni de nom). */
export function safeData(data?: Record<string, unknown>): Record<string, number | boolean> | undefined {
  if (!data) return undefined;
  const out: Record<string, number | boolean> = {};
  for (const [k, v] of Object.entries(data)) if (typeof v === 'number' || typeof v === 'boolean') out[k] = v;
  return out;
}
