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
 *
 * IMPORTANT : `responseText` ne peut pas être tronqué — XHR accumule tout le
 * texte reçu tant que la requête est ouverte. Pour éviter un memory leak
 * linéaire, la connexion est recyclée périodiquement (RECYCLE_AFTER_BYTES).
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

/** Recycle la connexion XHR après ~512 KB de responseText accumulé. */
const RECYCLE_AFTER_BYTES = 512 * 1024;

function parseChunk(raw: string): SseMessage | null {
  let id: string | null = null;
  let event = 'message';
  const dataLines: string[] = [];

  for (const line of raw.split('\n')) {
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
  let recycleTimer: ReturnType<typeof setTimeout> | null = null;

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

    request.addEventListener('readystatechange', () => {
      if (closed) return;

      if (request.readyState === 2 /* HEADERS_RECEIVED */) {
        if (request.status !== 200) return;
        opened = true;
        attempt = 0;
        options.onOpen?.();
        return;
      }

      if (request.readyState === 3 /* LOADING */) {
        if (!opened) return;
        const text = request.responseText;
        const boundary = text.lastIndexOf('\n\n');
        if (boundary < consumed) return;
        const pending = text.slice(consumed, boundary);
        consumed = boundary + 2;
        for (const chunk of pending.split('\n\n')) {
          if (!chunk.trim()) continue;
          const message = parseChunk(chunk);
          if (message) options.onMessage(message);
        }

        // Recycle: responseText ne peut pas être libéré tant que le XHR est
        // ouvert. On ferme et on rouvre proprement pour relâcher la mémoire.
        if (text.length > RECYCLE_AFTER_BYTES) {
          request.abort();
          xhr = null;
          // Petit délai pour ne pas boucler si le serveur renvoie un gros
          // payload d'un coup.
          recycleTimer = setTimeout(connect, 100);
        }
        return;
      }

      if (request.readyState === 4 /* DONE */) {
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
      if (recycleTimer) clearTimeout(recycleTimer);
      xhr?.abort();
      xhr = null;
    },
  };
}
