/**
 * Version des textes légaux = date de publication. À mettre à jour en même
 * temps que le contenu de `legal.content.ts` : toute modification de version
 * force les utilisateurs à ré-accepter (écran de consentement mobile).
 */
export const LEGAL_VERSIONS = {
  terms: '2026-10-22',
  privacy: '2026-10-22',
  remoteAccess: '2026-10-18',
} as const;

/** Compte créé par un client qui ne collectait pas le consentement : à redemander. */
export const LEGACY_LEGAL_VERSION = 'legacy';

export type LegalVersions = typeof LEGAL_VERSIONS;
