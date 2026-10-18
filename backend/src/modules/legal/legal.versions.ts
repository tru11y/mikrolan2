/**
 * Version des textes légaux = date de publication. À mettre à jour en même
 * temps que le contenu de `legal.content.ts` : toute modification de version
 * force les utilisateurs à ré-accepter (écran de consentement mobile).
 */
export const LEGAL_VERSIONS = {
  terms: '2026-09-01',
  privacy: '2026-09-01',
  remoteAccess: '2026-10-18',
} as const;

export type LegalVersions = typeof LEGAL_VERSIONS;
