// Verrou synchrone par action : un second appel pendant l'exécution est ignoré,
// sans attendre qu'un état React se propage. Toujours libéré (succès, erreur,
// échéance) : un nouvel essai explicite reste possible.

export interface ActionLock {
  /** Exécute `fn` si le verrou est libre ; sinon ignore l'appel et retourne false. */
  run(fn: () => Promise<void>): Promise<boolean>;
  readonly locked: boolean;
}

export function createActionLock(): ActionLock {
  let locked = false;
  return {
    get locked() {
      return locked;
    },
    async run(fn) {
      if (locked) return false;
      locked = true;
      try {
        await fn();
      } finally {
        locked = false;
      }
      return true;
    },
  };
}
