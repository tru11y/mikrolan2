// Logique pure de l'écran « Vendeurs » (testable sans React).
// Les règles reprennent celles du backend (verifier.schemas.ts) ; le serveur
// reste l'autorité finale.

export type FormErrorKey = 'invalidEmail' | 'weakPassword' | 'nameTooLong';

export const PASSWORD_MIN = 8;
export const PASSWORD_MAX = 128;
export const NAME_MAX = 120;
export const EMAIL_MAX = 254;

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function isValidEmail(raw: string): boolean {
  const v = raw.trim();
  return v.length > 0 && v.length <= EMAIL_MAX && EMAIL_RE.test(v);
}

export function isValidPassword(raw: string): boolean {
  return raw.length >= PASSWORD_MIN && raw.length <= PASSWORD_MAX;
}

export interface NewVerifierForm {
  email: string;
  password: string;
  name: string;
}

/** Retourne la première erreur de saisie, ou null si le formulaire est valide. */
export function validateNewVerifier(f: NewVerifierForm): FormErrorKey | null {
  if (!isValidEmail(f.email)) return 'invalidEmail';
  if (!isValidPassword(f.password)) return 'weakPassword';
  if (f.name.trim().length > NAME_MAX) return 'nameTooLong';
  return null;
}

/** Corps envoyé au serveur : jamais de rôle, tenant, statut ni identifiant d'auteur. */
export function buildCreateBody(
  f: NewVerifierForm,
  routerId: string | null,
): { email: string; password: string; name?: string; routerId?: string } {
  const name = f.name.trim();
  return {
    email: f.email.trim(),
    password: f.password,
    ...(name ? { name } : {}),
    ...(routerId ? { routerId } : {}),
  };
}

/** Libellé court d'un routeur affecté (alias en priorité). */
export function routerLabel(
  a: { routerIdentity: string; routerAlias: string | null } | null,
): string | null {
  if (!a) return null;
  return a.routerAlias?.trim() || a.routerIdentity;
}

/** Nom affiché : nom saisi, sinon l'e-mail. */
export function displayName(v: { name: string | null; email: string }): string {
  return v.name?.trim() || v.email;
}

export type PasswordErrorKey = 'weakPassword' | 'mismatch';

/** Nouveau mot de passe + confirmation (réinitialisation). */
export function validateNewPassword(password: string, confirm: string): PasswordErrorKey | null {
  if (!isValidPassword(password)) return 'weakPassword';
  if (password !== confirm) return 'mismatch';
  return null;
}

/** Un vendeur sans routeur affecté n'est pas prêt à vérifier des tickets. */
export function isReadyToVerify(v: {
  status: 'ACTIVE' | 'SUSPENDED' | 'DELETED';
  assignment: unknown | null;
}): boolean {
  return v.status === 'ACTIVE' && v.assignment !== null;
}

// ── Mutations incertaines (réponse non reçue) ─────────────────────────────
// Un délai local ne prouve pas que le serveur n'a rien fait : on relit la liste
// et on réconcilie, sans jamais renvoyer automatiquement une requête.

export type MutationKind = 'create' | 'assign' | 'status' | 'resetPassword' | 'remove';

export const MUTATION_DEADLINE_MS = 20000;

export interface UncertainPlan {
  /** Clé i18n du message affiché immédiatement. */
  messageKey: string;
  /** Relire la liste pour réconcilier. */
  refetch: boolean;
  /** Vider les champs de mot de passe. */
  clearSecrets: boolean;
  /** Jamais de renvoi automatique. */
  autoRetry: false;
}

export function planForUncertain(kind: MutationKind): UncertainPlan {
  switch (kind) {
    case 'create':
      return { messageKey: 'verifiers.uncertainCreate', refetch: true, clearSecrets: false, autoRetry: false };
    case 'resetPassword':
      return { messageKey: 'verifiers.uncertainReset', refetch: false, clearSecrets: true, autoRetry: false };
    default:
      return { messageKey: 'verifiers.uncertainOther', refetch: true, clearSecrets: false, autoRetry: false };
  }
}

type ListedVerifier = {
  id: string;
  email: string;
  status: 'ACTIVE' | 'SUSPENDED' | 'DELETED';
  assignment: { routerId: string } | null;
};

/** Création : l'e-mail (unique) sert de clé de réconciliation. */
export function reconcileCreate(items: ListedVerifier[], email: string): 'created' | 'absent' {
  const wanted = email.trim().toLowerCase();
  return items.some((v) => v.email.trim().toLowerCase() === wanted) ? 'created' : 'absent';
}

/** Suppression : absent de la liste active = supprimé. */
export function reconcileRemove(items: ListedVerifier[], id: string): 'removed' | 'present' {
  return items.some((v) => v.id === id) ? 'present' : 'removed';
}

export function reconcileStatus(
  items: ListedVerifier[],
  id: string,
  wanted: 'ACTIVE' | 'SUSPENDED',
): 'applied' | 'not-applied' {
  const v = items.find((i) => i.id === id);
  return v && v.status === wanted ? 'applied' : 'not-applied';
}

export function reconcileAssign(
  items: ListedVerifier[],
  id: string,
  routerId: string,
): 'applied' | 'not-applied' {
  const v = items.find((i) => i.id === id);
  return v?.assignment?.routerId === routerId ? 'applied' : 'not-applied';
}
