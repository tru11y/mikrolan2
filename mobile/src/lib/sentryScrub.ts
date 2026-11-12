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
  // Identifiants opaques (CUID/CUID2, UUID, ULID, ObjectId) : avant le filtre téléphone.
  [/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi, '[id]'],
  [/\bc[a-z0-9]{20,}\b/g, '[id]'],
  [/\b[0-9A-HJKMNP-TV-Z]{26}\b/g, '[id]'],
  [/\b[0-9a-f]{24}\b/gi, '[id]'],
  // Code de ticket (ex. 3d1005, 1m60477416, 7h5421251) où qu'il soit dans un texte.
  [/\b\d{1,2}[a-z]\d{4,}\b/gi, '[ticket]'],
  // Mot-clé suivi d'une valeur secrète en texte libre : on garde le mot-clé, on masque la valeur.
  [/\b(pass(?:word)?|pwd|mot de passe|secret|saspay|ref(?:erence)?|txn|transaction|ticket(?:[ _-]?code)?|voucher(?:[ _-]?code)?|code)\s*[:=]?\s*(?!\[)[^\s,;)]+/gi, '$1 [Filtré]'],
  // Téléphone : indicatif + chiffres, ou 9 à 14 chiffres groupés ; jamais une date ISO ni un numéro de build.
  [/\+\d{1,3}(?:[ -]?\d){8,13}\b/g, '[tel]'],
  [/\b\d(?:[ -]?\d){8,13}\b/g, '[tel]'],
  [/([?&](?:code|token|password|pass|pwd|q|search|key|secret|voucher|username|user)=)[^&\s"']*/gi, '$1[Filtré]'],
];

export function scrubString(s: string): string {
  // « status code 401 » est un diagnostic utile : on le protège du filtre « code <valeur> ».
  const protectedText = s.replace(/\b(status) code (\d{3})\b/gi, '$1_code_$2');
  const cleaned = PATTERNS.reduce((acc, [re, to]) => acc.replace(re, to), protectedText);
  return cleaned.replace(/\b(status)_code_(\d{3})\b/gi, '$1 code $2');
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

/** Contextes générés par le SDK (appareil, OS, app…) laissés intacts ; les autres sont nettoyés à l'intérieur. */
const SDK_CONTEXTS = new Set(['app', 'device', 'os', 'ota_updates', 'react_native_context', 'trace', 'culture', 'runtime', 'browser']);

function scrubContexts(contexts: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [name, ctx] of Object.entries(contexts)) {
    if (SDK_CONTEXTS.has(name)) {
      out[name] = ctx;
    } else {
      out[name] = ctx && typeof ctx === 'object' ? scrubValue(ctx) : { value: REDACTED };
    }
  }
  const device = out.device as Record<string, unknown> | undefined;
  if (device && typeof device === 'object') delete device.id;
  return out;
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
  if (event.contexts) event.contexts = scrubContexts(event.contexts);
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
