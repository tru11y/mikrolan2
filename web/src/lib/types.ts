// Types partagés web — miroir des contrats API NestJS.
// Les sous-agents IMPORTENT depuis ce fichier et ne le modifient pas.

export type UserRole = 'SUPER_ADMIN' | 'ADMIN' | 'MEMBER' | 'TICKET_VERIFIER';

// Utilisateur aplati exposé par useAuth().me (construit depuis la réponse
// imbriquée de GET /auth/me : { user, tenant, subscription, entitlement, legal }).
export type Me = {
  id: string;
  email: string;
  role: UserRole;
  name?: string | null;
  tenantId: string;
  status?: string;
  hasPassword?: boolean;
  googleId?: string | null;
  notificationsEnabled?: boolean;
};

// Réponse brute de GET /auth/me.
export type MeResponse = {
  user: {
    id: string;
    email: string;
    name?: string | null;
    role: UserRole;
    status?: string;
    notificationsEnabled?: boolean;
    hasPassword?: boolean;
    googleId?: string | null;
    termsVersion?: string | null;
    privacyVersion?: string | null;
    country?: string | null;
  };
  tenant: { id: string; name: string; slug: string; status?: string; country?: string | null };
  subscription?: { plan?: string | null; status?: string | null; currentPeriodEnd?: string | null } | null;
  entitlement?: Record<string, unknown>;
  legal?: unknown;
};

export type RouterHealth = 'ONLINE' | 'OFFLINE' | 'DEGRADED' | 'UNKNOWN';
export type ManagementMode = 'LOCAL' | 'REMOTE';

export type RouterSummary = {
  id: string;
  identity: string;
  alias?: string | null;
  mode: ManagementMode;
  health: RouterHealth;
  lastHeartbeat?: string | null;
};

export type MetricsPeriod = 'today' | 'yesterday' | '7d' | '30d';

export type PlanRevenue = {
  planId: string;
  planName: string;
  priceXof: number;
  sold: number;
  revenueXof: number;
  dataQuality?: string;
};

export type MetricsSummary = {
  period: MetricsPeriod;
  revenueXof: number;
  ticketsGenerated: number;
  ticketsUsed: number;
  activeSessions: number;
  previousRevenueXof: number;
  trendPct: number | null;
  byPlan: PlanRevenue[];
  dataQuality?: string;
};

export type RecentClient = {
  id: string;
  code: string;
  status: VoucherStatus | string;
  usedAt?: string | null;
  planName?: string | null;
  routerIdentity?: string | null;
  online: boolean;
  macAddress?: string | null;
  ipAddress?: string | null;
};

export type Plan = {
  id: string;
  name: string;
  slug: string;
  priceXof: number;
  durationMinutes: number;
  sharedUsers: number;
  status: string;
};

export type VoucherStatus = 'GENERATED' | 'ACTIVE' | 'USED' | 'EXPIRED' | 'REVOKED';
export type Voucher = {
  id: string;
  code: string;
  status: VoucherStatus;
  planName?: string | null;
  createdAt: string;
  usedAt?: string | null;
  expiresAt?: string | null;
};

export type SessionRow = {
  id: string;
  macAddress?: string | null;
  ipAddress?: string | null;
  status: string;
  bytesIn: number;
  bytesOut: number;
  startedAt: string;
  lastSeenAt?: string | null;
};

export type NotificationRow = {
  id: string;
  title: string;
  body?: string | null;
  read: boolean;
  createdAt: string;
};

export type Paginated<T> = { items: T[]; nextCursor?: string | null; total?: number };
