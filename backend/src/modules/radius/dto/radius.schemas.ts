import { z } from 'zod';

/**
 * `rlm_rest` aplatit les attributs RADIUS en clés JSON. Certaines valeurs
 * arrivent encapsulées dans un tableau à un seul élément (`["value"]`) selon la
 * version du module ; `singleString` normalise les deux formes (cf.
 * `headerString` de saspay-webhook pour le même besoin côté en-têtes HTTP).
 */
export function singleString(v: unknown): unknown {
  if (Array.isArray(v)) return v.length > 0 ? v[0] : undefined;
  return v;
}

const optionalString = z.preprocess(singleString, z.string().trim().min(1).optional());
// La version de zod du repo n'expose pas `.ip()` : on valide une forme IPv4/IPv6
// minimale par regex (une adresse mal formée est écartée, pas de faux positif de matching NAS).
const IP_RE = /^(\d{1,3}(\.\d{1,3}){3}|[0-9a-fA-F:]+)$/;
const optionalIp = z.preprocess(
  singleString,
  z
    .string()
    .trim()
    .regex(IP_RE)
    .optional(),
);

/**
 * Compteur RADIUS : valeur absolue, jamais négative. Absente → 0. Les
 * Gigawords portent les débordements au-delà de 2^32 (voir `assembleOctets`).
 */
const counter = z.preprocess(singleString, z.coerce.bigint().nonnegative().default(0n));

export const authorizeSchema = z
  .object({
    'User-Name': z.preprocess(singleString, z.string().trim().min(1)),
    'NAS-IP-Address': optionalIp,
    'NAS-Identifier': optionalString,
    'Calling-Station-Id': optionalString,
    'Called-Station-Id': optionalString,
    'Framed-IP-Address': optionalIp,
  })
  .refine((d) => Boolean(d['NAS-IP-Address'] ?? d['NAS-Identifier']), {
    message: 'NAS-IP-Address ou NAS-Identifier requis',
    path: ['NAS-Identifier'],
  });

export type AuthorizeDto = z.infer<typeof authorizeSchema>;

export const ACCT_STATUS_TYPES = [
  'Start',
  'Interim-Update',
  'Stop',
  'Accounting-On',
  'Accounting-Off',
] as const;

export type AcctStatusType = (typeof ACCT_STATUS_TYPES)[number];

export const accountingSchema = z
  .object({
    'Acct-Status-Type': z.preprocess(singleString, z.enum(ACCT_STATUS_TYPES)),
    // Absent sur Accounting-On / Accounting-Off (évènement au niveau NAS).
    'User-Name': optionalString,
    'NAS-IP-Address': optionalIp,
    'NAS-Identifier': optionalString,
    'Acct-Session-Id': optionalString,
    // Clé d'idempotence : identifie de façon unique une session côté NAS.
    'Acct-Unique-Session-Id': optionalString,
    'Acct-Input-Octets': counter,
    'Acct-Output-Octets': counter,
    'Acct-Input-Gigawords': counter,
    'Acct-Output-Gigawords': counter,
    'Acct-Session-Time': counter,
    'Framed-IP-Address': optionalIp,
    'Calling-Station-Id': optionalString,
  })
  .refine((d) => Boolean(d['NAS-IP-Address'] ?? d['NAS-Identifier']), {
    message: 'NAS-IP-Address ou NAS-Identifier requis',
    path: ['NAS-Identifier'],
  });

export type AccountingDto = z.infer<typeof accountingSchema>;

/** Réponse d'autorisation acceptée : attributs de réponse FreeRADIUS (contrôle). */
export interface AuthorizeReply {
  'control:Auth-Type': 'Accept';
  'reply:Session-Timeout'?: number;
  'reply:Mikrotik-Total-Limit'?: string;
  'reply:Mikrotik-Rate-Limit'?: string;
  'reply:Acct-Interim-Interval': number;
}

/** Réponse de rejet : le NAS refuse la connexion. */
export interface AuthorizeReject {
  'control:Auth-Type': 'Reject';
  'reply:Reply-Message': string;
}

export type AuthorizeResponse = AuthorizeReply | AuthorizeReject;
