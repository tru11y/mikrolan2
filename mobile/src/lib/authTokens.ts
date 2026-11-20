// Sérialisation de la paire de jetons en une seule valeur de stockage (écriture
// atomique). Module pur (aucune dépendance React Native) → testable sous node:test.

export interface StoredTokens {
  accessToken: string;
  refreshToken: string;
}

const VERSION = 1;

export function serializeTokens(tokens: StoredTokens): string {
  return JSON.stringify({ v: VERSION, accessToken: tokens.accessToken, refreshToken: tokens.refreshToken });
}

/** Lecture tolérante : valeur absente, corrompue ou incomplète → null. */
export function parseStoredTokens(raw: string | null): StoredTokens | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as { accessToken?: unknown; refreshToken?: unknown };
    if (typeof parsed.accessToken === 'string' && typeof parsed.refreshToken === 'string') {
      return { accessToken: parsed.accessToken, refreshToken: parsed.refreshToken };
    }
  } catch {
    // Valeur corrompue : traitée comme absente.
  }
  return null;
}
