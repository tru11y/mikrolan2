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
