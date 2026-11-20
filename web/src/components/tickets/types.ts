// Types locaux au cluster « Tickets & Forfaits » — miroirs des contrats API
// NestJS. Définis ici (et non dans @/lib/types) conformément au contrat
// sous-agent : aucun fichier partagé n'est modifié.

import type { ManagementMode, RouterHealth, VoucherStatus } from '@/lib/types';

export type RouterLite = {
  id: string;
  identity: string;
  alias?: string | null;
  mode: ManagementMode;
  health: RouterHealth;
};

export type PlanStatus = 'ACTIVE' | 'ARCHIVED';
export type PlanCodeFormat = 'ALPHANUMERIC' | 'NUMERIC';
export type PlanExpiration = 'ELAPSED' | 'RADIO_PAUSE';

export type PlanFull = {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  durationMinutes: number;
  priceXof: number;
  downloadKbps: number | null;
  uploadKbps: number | null;
  dataLimitMb: number | null;
  sharedUsers: number;
  expirationMode: PlanExpiration;
  userProfile: string;
  codePrefix: string | null;
  codeLength: number;
  codeFormat: PlanCodeFormat;
  status: PlanStatus;
  displayOrder: number;
};

export type CreatePlanPayload = {
  name: string;
  durationMinutes: number;
  priceXof: number;
  downloadKbps?: number | null;
  uploadKbps?: number | null;
  dataLimitMb?: number | null;
  sharedUsers?: number;
  expirationMode?: PlanExpiration;
  description?: string;
  codePrefix?: string | null;
  codeLength?: number;
  codeFormat?: PlanCodeFormat;
};

export type UpdatePlanPayload = Partial<CreatePlanPayload>;

export type VoucherSearchItem = {
  id: string;
  code: string;
  status: VoucherStatus;
  batchId: string | null;
  planId: string;
  plan: { name: string; priceXof: number; durationMinutes: number };
  createdAt: string;
  usedAt: string | null;
  expiresAt: string | null;
};

export type VoucherSearchPage = {
  items: VoucherSearchItem[];
  nextCursor: string | null;
};

export type VoucherReprint = {
  id: string;
  code: string;
  password: string;
  status: VoucherStatus;
  plan: { name: string; priceXof: number; durationMinutes: number };
};

export type VoucherItem = {
  id: string;
  code: string;
  password: string;
  status: VoucherStatus;
  planId: string;
  routerId: string;
  batchId: string | null;
  expiresAt: string | null;
  usedAt: string | null;
  createdAt: string;
  provisioned: boolean;
};

export type GenerateResult = {
  batchId: string;
  batchSeq: number;
  batchStatus: 'GENERATING' | 'COMPLETED' | 'PARTIAL_SUCCESS' | 'FAILED';
  pushedByServer: boolean;
  pushedCount: number;
  totalCount: number;
  vouchers: VoucherItem[];
};

export const VOUCHER_STATUS_LABELS: Record<VoucherStatus, string> = {
  GENERATED: 'Généré',
  ACTIVE: 'Actif',
  USED: 'Utilisé',
  EXPIRED: 'Expiré',
  REVOKED: 'Révoqué',
};

export const VOUCHER_STATUS_TONES: Record<
  VoucherStatus,
  'success' | 'warning' | 'danger' | 'muted' | 'primary'
> = {
  GENERATED: 'muted',
  ACTIVE: 'success',
  USED: 'primary',
  EXPIRED: 'warning',
  REVOKED: 'danger',
};

/** Plafond serveur d'un lot de tickets. */
export const MAX_QUANTITY = 500;
export const CODE_LENGTH_MIN = 6;
export const CODE_LENGTH_MAX = 12;

export function durationLabel(minutes: number): string {
  if (minutes <= 0) return '—';
  if (minutes % 1440 === 0) return `${minutes / 1440} j`;
  if (minutes % 60 === 0) return `${minutes / 60} h`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return h > 0 ? `${h} h ${m} min` : `${m} min`;
}
