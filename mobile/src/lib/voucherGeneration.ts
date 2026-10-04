import type { GenerateResult } from './api';

/**
 * Décisions pures du flux de génération de tickets, isolées SANS import runtime
 * (react-native, axios…) pour pouvoir les couvrir avec `node --test`
 * (convention du dossier : `metricsCsvRows.test.ts`).
 */

export type GenerationOutcome = 'SUCCESS' | 'PARTIAL_SUCCESS' | 'FAILED';

/**
 * Le push LAN dépend du contrat réel du backend, pas d'un statut calculé avant le
 * push : le serveur n'a PAS provisionné les tickets (`pushedByServer === false`) et
 * fournit les paramètres de push. Routeur LOCAL : le lot arrive en `GENERATING`, c'est
 * au téléphone de créer les utilisateurs sur le routeur puis de confirmer (confirmPush).
 * Routeur REMOTE (`pushedByServer === true`) : jamais de second push.
 */
export function shouldPushViaLan(
  res: Pick<GenerateResult, 'pushedByServer' | 'push'>,
): boolean {
  return !res.pushedByServer && Boolean(res.push);
}

/**
 * Issue finale, calculée APRÈS la tentative de provisionnement : seuls comptent les
 * tickets réellement provisionnés (confirmés côté RouterOS), pas les lignes en base.
 */
export function finalGenerationOutcome(
  totalCount: number,
  provisionedCount: number,
): GenerationOutcome {
  if (provisionedCount <= 0) return 'FAILED';
  return provisionedCount < totalCount ? 'PARTIAL_SUCCESS' : 'SUCCESS';
}
