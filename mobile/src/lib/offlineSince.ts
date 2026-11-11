/**
 * Pourquoi la lecture live d'un routeur est vide : jamais lue, ou plus lue
 * depuis combien de temps. `lastSuccessAt` est un horodatage en ms (0 = aucune
 * lecture réussie depuis le démarrage du serveur).
 */
export type OfflineSince = { kind: 'never' } | { kind: 'since'; ageSeconds: number };

export function offlineSince(lastSuccessAt: number | null | undefined, nowMs: number): OfflineSince {
  if (!lastSuccessAt || lastSuccessAt <= 0) return { kind: 'never' };
  return { kind: 'since', ageSeconds: Math.max(0, Math.round((nowMs - lastSuccessAt) / 1000)) };
}
