// Garantit qu'un appel réseau se termine : abort natif + rejet JS à l'échéance.
// Le timeout Axios de React Native ne couvre pas toujours une connexion qui
// reste en attente (ex. après une coupure réseau) ; sans cela le verrou
// anti-double-tap de l'écran vendeur restait fermé indéfiniment.

export class HardTimeoutError extends Error {
  constructor(ms: number) {
    super(`Request exceeded ${ms}ms`);
    this.name = 'HardTimeoutError';
  }
}

/**
 * Course entre `call` et une échéance. À l'échéance : `controller.abort()`
 * (annulation native) puis rejet JS immédiat, même si l'abort ne se propage pas.
 * Le timer est toujours nettoyé.
 */
export async function withDeadline<T>(
  call: Promise<T>,
  controller: AbortController,
  ms: number,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(new HardTimeoutError(ms));
    }, ms);
  });
  try {
    return await Promise.race([call, deadline]);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Crée le contrôleur, le transmet à `run` (signal) et applique l'échéance.
 * À l'échéance : abort natif + rejet HardTimeoutError.
 */
export function callWithDeadline<T>(
  run: (signal: AbortSignal) => Promise<T>,
  ms: number,
): Promise<T> {
  const controller = new AbortController();
  return withDeadline(run(controller.signal), controller, ms);
}
