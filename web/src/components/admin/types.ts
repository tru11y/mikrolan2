// Types locaux au cluster back-office — miroirs des contrats API NestJS.
// Définis ici (et non dans @/lib/types) pour ne modifier aucun fichier partagé.

import type { ManagementMode, RouterHealth, UserRole } from '@/lib/types';

export type SubscriptionPlan = 'FREE' | 'PRO';
export type BillingPeriod = 'MONTHLY' | 'ANNUAL';
export type TenantStatus = 'ACTIVE' | 'SUSPENDED' | 'DELETED';
export type UserStatus = 'ACTIVE' | 'SUSPENDED' | 'DELETED';
export type VerifierStatus = 'ACTIVE' | 'SUSPENDED' | 'DELETED';

export type Page<T> = { items: T[]; nextCursor: string | null };

export type PlatformMetrics = {
  tenants: { total: number; pro: number; trialing: number; suspended: number; locked: number };
  revenue: { mrrXof: number; currency: string; untieredActive: number };
  trialsExpiringIn7Days: number;
  pendingInvoices: number;
  routers: { total: number; online: number; offline: number; degraded: number };
  vouchers30d: { generated: number; activated: number };
  sessions: { active: number };
  support: { open: number; overdue: number };
  generatedAt: string;
};

export type AdminTenant = {
  id: string;
  name: string;
  slug: string;
  status: TenantStatus;
  createdAt: string;
  plan: SubscriptionPlan;
  subscriptionStatus: string | null;
  tierKey: string | null;
  tierName: string | null;
  currentPeriodEnd: string | null;
  userCount: number;
  routerCount: number;
};

export type AdminTenantDetail = {
  id: string;
  name: string;
  slug: string;
  status: TenantStatus;
  createdAt: string;
  subscription: {
    plan: SubscriptionPlan;
    status: string;
    billingPeriod: BillingPeriod | null;
    currentPeriodStart: string | null;
    currentPeriodEnd: string | null;
    tier: { key: string; name: string; monthlyXof: number } | null;
  } | null;
  users: {
    id: string;
    email: string;
    name: string | null;
    role: UserRole;
    status: UserStatus;
    lastLoginAt: string | null;
    createdAt: string;
  }[];
  _count: { routers: number };
  invoices: {
    id: string;
    amount: number;
    currency: string;
    status: string;
    billingPeriod: BillingPeriod;
    note: string | null;
    createdAt: string;
    paidAt: string | null;
    tier: { key: string; name: string } | null;
  }[];
};

export type AdminTenantRouter = {
  id: string;
  identity: string;
  alias: string | null;
  model: string | null;
  localAddress: string | null;
  mode: ManagementMode;
  health: RouterHealth;
  lastHeartbeat: string | null;
  createdAt: string;
};

export type AdminUser = {
  id: string;
  email: string;
  name: string | null;
  role: UserRole;
  status: UserStatus;
  lastLoginAt: string | null;
  createdAt: string;
  tenantId: string;
  tenantName: string;
};

export type AdminInvoice = {
  id: string;
  tenantId: string;
  tenantName: string;
  amount: number;
  currency: string;
  status: string;
  billingPeriod: BillingPeriod;
  periodDays: number;
  note: string | null;
  tierKey: string | null;
  tierName: string | null;
  createdAt: string;
  paidAt: string | null;
};

export type PaymentProof = {
  id: string;
  invoiceId: string;
  method: 'WAVE' | 'ORANGE_MONEY';
  imageUrl: string;
  note: string | null;
  createdAt: string;
};

export type TierFeature = { label: string; included: boolean };

export type Tier = {
  id: string;
  key: string;
  name: string;
  monthlyXof: number;
  annualMonthlyXof: number;
  annualDiscount: number;
  routerLimit: number | null;
  remoteAccess: boolean;
  a4Printing: boolean;
  cloudBackup: boolean;
  prioritySupport: boolean;
  badge: string | null;
  tagline: string | null;
  features: TierFeature[];
  displayOrder: number;
  active: boolean;
};

export type CreateTierInput = {
  key: string;
  name: string;
  monthlyXof: number;
  annualDiscount?: number;
  routerLimit?: number | null;
  features: TierFeature[];
  displayOrder?: number;
  active?: boolean;
};

export type TierPatch = Partial<{
  name: string;
  monthlyXof: number;
  annualDiscount: number;
  routerLimit: number | null;
  badge: string | null;
  tagline: string | null;
  displayOrder: number;
  active: boolean;
}>;

export type FleetTelemetry = {
  cpuPercent: number | null;
  ramUsedMb: number | null;
  ramTotalMb: number | null;
  uptime: string | null;
  rosVersion: string | null;
  boardName: string | null;
  hotspotActive: number | null;
  health: string;
  collectedAt: string;
};

export type FleetRouter = {
  id: string;
  identity: string;
  alias: string | null;
  model: string | null;
  mode: string;
  health: string;
  lastSyncAt: string | null;
  lastSyncError: string | null;
  syncFailCount: number;
  createdAt: string;
  tenant: { id: string; name: string; slug: string };
  remotePeer: { status: string; wgIp: string } | null;
  telemetry: FleetTelemetry | null;
};

export type RevenueHistoryItem = { month: string; total: number; count: number };

export type WgPeerState = string;

export type WgPeerRow = {
  id: string;
  status: 'PENDING' | 'ACTIVE' | 'REVOKED' | 'ERROR';
  state: WgPeerState;
  tenant: { id: string; name: string };
  router: { id: string; alias: string | null; identity: string; health: string; mode: string };
  wgIp: string;
  allocatedPort: number;
  provisionedAt: string | null;
  revokedAt: string | null;
  lastHandshakeAt: string | null;
  staleness: 'OK' | 'STALE_24H' | 'NEVER_CONNECTED';
  inactiveSince: string | null;
  handshakeAgeS: number | null;
  rxBytes: number | null;
  txBytes: number | null;
  clientEndpoint: string | null;
  lastHeartbeat: string | null;
};

export type WgPeersResponse = {
  items: WgPeerRow[];
  total: number;
  summary: {
    total: number;
    stale24h: number;
    neverConnected: number;
    healthy: number;
    pending: number;
    revoked: number;
    error: number;
    wgEnabled: boolean;
    liveAvailable: boolean;
  };
};

export type VerifierItem = {
  id: string;
  email: string;
  name: string | null;
  status: VerifierStatus;
  lastLoginAt: string | null;
  createdAt: string;
  assignment: {
    routerId: string;
    routerIdentity: string;
    routerAlias: string | null;
  } | null;
};

export type CreateVerifierInput = {
  email: string;
  password: string;
  name?: string;
  routerId?: string;
};

export type StatusTone = 'success' | 'warning' | 'danger' | 'muted' | 'primary';
