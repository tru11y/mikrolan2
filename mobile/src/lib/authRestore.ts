/**
 * Restauration de session : une erreur réseau, un délai dépassé ou une panne serveur ne doivent JAMAIS
 * effacer les jetons de connexion ; seul un rejet explicite du serveur (401/403, autre 4xx) le fait.
 * Fonctions pures, sans dépendance.
 */
type HttpLikeError = { response?: { status?: number } } | null | undefined;

export function httpStatus(err: unknown): number | undefined {
  return (err as HttpLikeError)?.response?.status;
}

/** Transitoire = pas de réponse du serveur (réseau, délai) ou réponse 408/429/5xx : on garde la session. */
export function isTransientError(err: unknown): boolean {
  const status = httpStatus(err);
  if (status === undefined) return true;
  return status === 408 || status === 429 || status >= 500;
}

const DEFAULT_DELAYS_MS = [1000, 2500];

/** Relit le profil ; réessaie les erreurs transitoires avec une courte attente, jamais les rejets. */
export async function fetchProfileWithRetry<T>(
  fetchMe: () => Promise<T>,
  opts: { delaysMs?: number[]; sleep?: (ms: number) => Promise<void> } = {},
): Promise<T> {
  const delays = opts.delaysMs ?? DEFAULT_DELAYS_MS;
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  for (let attempt = 0; ; attempt++) {
    try {
      return await fetchMe();
    } catch (err) {
      const wait = delays[attempt];
      if (!isTransientError(err) || wait === undefined) throw err;
      await sleep(wait);
    }
  }
}
