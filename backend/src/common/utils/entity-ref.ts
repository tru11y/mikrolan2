import { createHash } from 'node:crypto';

/**
 * Référence stable et non réversible d'une entité (tenant, peer, épisode…) pour les logs et Sentry :
 * SHA-256 tronqué à 16 hex. Aucun identifiant brut ne doit sortir de l'application.
 */
export function entityRef(value: string): string {
  return createHash('sha256').update(value).digest('hex').slice(0, 16);
}
