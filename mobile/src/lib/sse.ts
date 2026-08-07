/**
 * Client Server-Sent Events pour React Native.
 *
 * `EventSource` n'existe pas dans RN, et les implémentations tierces imposent
 * un module natif — donc une reconstruction de l'APK. Celle-ci s'appuie sur
 * `XMLHttpRequest`, présent partout, dont `responseText` s'allonge au fil des
 * octets reçus (`readyState === LOADING`).
 *
 * Elle apporte en plus ce qu'`EventSource` ne sait pas faire : envoyer un
 * en-tête `Authorization`, indispensable ici puisque l'API est protégée par
 * un jeton porteur.
 */

export interface SseMessage {
  id: string | null;
  event: string;
  data: string;
}

export interface SseOptions {
  url: string;
  /** Relu à chaque (re)connexion : le jeton d'accès expire en cours de flux. */
  headers?: () => Record<string, string>;
  onMessage: (message: SseMessage) => void;
  onOpen?: () => void;
  /** Appelé à chaque coupure, avec le nombre d'échecs consécutifs. */
  onError?: (attempt: number) => void;
  /** Reprise du flux : dernier identifiant traité. */
  lastEventId?: () => string | null;
}

export interface SseConnection {
  close: () => void;
}

const BASE_RETRY_MS = 2_000;
const MAX_RETRY_MS = 30_000;

function parseChunk(raw: string): SseMessage | null {
  let id: string | null = null;
  let event = 'message';
  const dataLines: string[] = [];

  for (const line of raw.split('\n')) {
    // Une ligne commençant par ':' est un commentaire (battement de cœur).
    if (line.startsWith(':')) continue;
    const sep = line.indexOf(':');
    const field = sep === -1 ? line : line.slice(0, sep);
    const value = sep === -1 ? '' : line.slice(sep + 1).replace(/^ /, '');
    if (field === 'id') id = value;
    else if (field === 'event') event = value;
    else if (field === 'data') dataLines.push(value);
  }

  if (!dataLines.length) return null;
  return { id, event, data: dataLines.join('\n') };
}

/**
 * Ouvre le flux et le maintient. Reconnexion automatique avec attente
 * croissante : un serveur qui redémarre ne doit pas être martelé par tous les
 * téléphones à la seconde.
 */
export function openSse(options: SseOptions): SseConnection {
  let closed = false;
  let attempt = 0;
  let xhr: XMLHttpRequest | null = null;
  let retryTimer: ReturnType<typeof setTimeout> | null = null;

  function scheduleReconnect() {
    if (closed) return;
    attempt += 1;
    options.onError?.(attempt);
    const delay = Math.min(BASE_RETRY_MS * 2 ** (attempt - 1), MAX_RETRY_MS);
    retryTimer = setTimeout(connect, delay);
  }

  function connect() {
    if (closed) return;

    const lastId = options.lastEventId?.() ?? null;
    // Le paramètre de requête double l'en-tête : certains proxys filtrent les
    // en-têtes non standard, et perdre la reprise passerait inaperçu.
    const url = lastId
      ? `${options.url}${options.url.includes('?') ? '&' : '?'}lastEventId=${encodeURIComponent(lastId)}`
      : options.url;

    const request = new XMLHttpRequest();
    xhr = request;
    let consumed = 0;
    let opened = false;

    request.open('GET', url, true);
    request.setRequestHeader('Accept', 'text/event-stream');
    request.setRequestHeader('Cache-Control', 'no-cache');
    if (lastId) request.setRequestHeader('Last-Event-ID', lastId);
    for (const [key, value] of Object.entries(options.headers?.() ?? {})) {
      request.setRequestHeader(key, value);
    }

    // `addEventListener`, surtout pas `request.onreadystatechange = …` :
    // React Native n'active la livraison incrémentale (`_incrementalEvents`)
    // que dans `addEventListener('readystatechange'|'progress')`. L'affectation
    // directe passe par l'attribut d'évènement du shim et laisse le drapeau à
    // faux — le natif attend alors le corps complet, qui n'arrive jamais sur un
    // flux SSE, et la requête finit annulée sans qu'un seul octet remonte.
    request.addEventListener('readystatechange', () => {
      if (closed) return;

      if (request.readyState === 2 /* HEADERS_RECEIVED */) {
        if (request.status !== 200) return; // traité à la fermeture
        opened = true;
        attempt = 0;
        options.onOpen?.();
        return;
      }

      if (request.readyState === 3 /* LOADING */) {
        if (!opened) return;
        const text = request.responseText;
        // Un évènement se termine par une ligne vide ; tout ce qui suit le
        // dernier séparateur est incomplet et doit attendre le prochain octet.
        const boundary = text.lastIndexOf('\n\n');
        if (boundary < consumed) return;
        const pending = text.slice(consumed, boundary);
        consumed = boundary + 2;
        for (const chunk of pending.split('\n\n')) {
          if (!chunk.trim()) continue;
          const message = parseChunk(chunk);
          if (message) options.onMessage(message);
        }
        return;
      }

      if (request.readyState === 4 /* DONE */) {
        // Le serveur a fermé (redémarrage, proxy, perte réseau) : on relance.
        scheduleReconnect();
      }
    });

    request.addEventListener('error', () => {
      if (!closed) scheduleReconnect();
    });

    request.send();
  }

  connect();

  return {
    close() {
      closed = true;
      if (retryTimer) clearTimeout(retryTimer);
      // `abort()` déclenche readyState 4 : `closed` empêche la reconnexion.
      xhr?.abort();
      xhr = null;
    },
  };
}
