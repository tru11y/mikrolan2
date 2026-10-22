const DAY_MS = 86_400_000;

/** Durées de conservation annoncées dans la politique de confidentialité. */
export const RETENTION = {
  auditLogDays: 365,
  // Archive d'audit (données sans lien direct avec la personne après anonymisation) : durée à valider juridiquement.
  auditArchiveDays: 3650,
  paymentProofDays: 730,
  anonymizeDeletedUserDays: 30,
  revokedRouterCredentialsDays: 7,
} as const;

export const PURGE_BATCH_SIZE = 500;

export function daysAgo(days: number, now: Date): Date {
  return new Date(now.getTime() - days * DAY_MS);
}
