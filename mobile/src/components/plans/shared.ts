import { type Plan, type PlanCodeFormat } from '@/src/lib/api';

/**
 * Bornes du code imprimé sur le ticket.
 *
 * En dessous de 7 caractères un code se devine par force brute depuis le
 * portail captif ; au-delà de 12 le client se trompe en le recopiant. Le
 * serveur accepte encore 4 (schéma historique) — c'est l'app qui refuse.
 */
export const CODE_LENGTH_MIN = 7;
export const CODE_LENGTH_MAX = 12;

// Mêmes alphabets que le générateur serveur (voucher.service.ts) : sans I, O,
// 0 et 1 en alphanumérique, qui se confondent à l'impression thermique.
const SAMPLE_ALPHANUMERIC = 'K7F9QXZ3M2VBTRN4';
const SAMPLE_NUMERIC = '9831720465198327';

export function fmtDuration(min: number): string {
  if (min % 1440 === 0) return `${min / 1440}j`;
  if (min % 60 === 0) return `${min / 60}h`;
  return `${min}min`;
}

/** Aperçu du code tel qu'il sortira, à la longueur et au préfixe choisis. */
export function sampleCode(
  format: PlanCodeFormat,
  prefix: string,
  length: string,
): string {
  const n = Math.min(
    CODE_LENGTH_MAX,
    Math.max(CODE_LENGTH_MIN, Number.parseInt(length, 10) || CODE_LENGTH_MIN),
  );
  const pool = format === 'NUMERIC' ? SAMPLE_NUMERIC : SAMPLE_ALPHANUMERIC;
  return prefix.trim() + pool.slice(0, n);
}

export function speedLabel(p: Plan): string {
  const up = p.uploadKbps ? Math.round(p.uploadKbps / 1000) : null;
  const down = p.downloadKbps ? Math.round(p.downloadKbps / 1000) : null;
  if (up && down) return `${up}M/${down}M`;
  if (down) return `${down}M`;
  return 'Illimité';
}
