export class DeadlineExceededError extends Error {}

/**
 * Rejette après `ms` si `work` n'a pas terminé. Ne l'annule pas (une promesse ne
 * s'annule pas) : sert uniquement à libérer un verrou qu'un travail bloqué
 * garderait indéfiniment.
 */
export function withDeadline<T>(work: Promise<T>, ms: number, what: string): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () => reject(new DeadlineExceededError(`${what} : délai de ${ms} ms dépassé`)),
      ms,
    );
    timer.unref?.();
  });
  // Le travail abandonné peut encore échouer plus tard : pas de rejet non géré.
  work.catch(() => undefined);
  return Promise.race([work, deadline]).finally(() => clearTimeout(timer));
}
