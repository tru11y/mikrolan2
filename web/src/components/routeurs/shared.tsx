'use client';

import type { ReactNode } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Badge, Dot } from '@/components/ui';
import type { ManagementMode, RouterHealth } from '@/lib/types';

// ── Types locaux (non présents dans @/lib/types ; ne pas éditer types.ts) ────

export type RouterItem = {
  id: string;
  identity: string;
  alias: string | null;
  model: string | null;
  localAddress: string | null;
  mode: ManagementMode;
  health: RouterHealth;
  lastHeartbeat: string | null;
  ticketTemplate: TicketTemplate | null;
  pushNotifications: boolean;
  hasCredentials?: boolean;
  createdAt: string;
  updatedAt: string;
};

export type TicketTemplate = {
  showCompanyName: boolean;
  companyName?: string;
  showWifiName: boolean;
  wifiName?: string;
  showPrice: boolean;
  showDuration?: boolean;
  showQrCode: boolean;
  showPlanName: boolean;
  showTicketNumber: boolean;
  showCreatedAt: boolean;
  showPoweredBy: boolean;
  showNote: boolean;
  note?: string;
  currency: string;
};

export type RemoteStatus = {
  status: 'ACTIVE' | 'REVOKED' | 'PENDING' | 'ERROR' | 'NONE';
  wgIp?: string;
  allocatedPort?: number;
  endpoint?: string;
  provisionedAt?: string | null;
  revokedAt?: string | null;
  accessUrls?: RemoteAccessUrls | null;
};

export type RemoteAccessUrls = {
  webfig: { url: string; port: number };
  ssh: { host: string; port: number; command: string };
  winbox: { host: string; port: number; address: string };
};

export type SystemResource = Record<string, string>;

export type RouterLiveData = {
  routerId: string;
  health: 'ONLINE' | 'OFFLINE' | 'UNKNOWN';
  tunnelState?: 'ACTIVE' | 'DOWN' | 'UNKNOWN';
  cpuPercent: number | null;
  memoryUsedMb: number | null;
  memoryTotalMb: number | null;
  uptime: string | null;
  rosVersion: string | null;
  boardName: string | null;
  sessionCount: number | null;
  sessions: LiveSession[] | null;
  ageMs: number;
  stale: boolean;
  refreshing: boolean;
  lastError: string | null;
};

export type LiveSession = {
  id: string;
  user: string;
  ipAddress: string | null;
  macAddress: string | null;
  bytesIn: string;
  bytesOut: string;
  uptime: string | null;
};

export type PlanExpiration = 'ELAPSED' | 'RADIO_PAUSE';
export type PlanCodeFormat = 'ALPHANUMERIC' | 'NUMERIC';
export type RouterPlan = {
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
  status: 'ACTIVE' | 'ARCHIVED';
  displayOrder: number;
};

export type CreatePlanPayload = {
  name: string;
  durationMinutes: number;
  priceXof: number;
  downloadKbps?: number | null;
  uploadKbps?: number | null;
  sharedUsers?: number;
  expirationMode?: PlanExpiration;
  codePrefix?: string | null;
  codeLength?: number;
  codeFormat?: PlanCodeFormat;
};

export type VoucherStatusX = 'GENERATED' | 'ACTIVE' | 'USED' | 'EXPIRED' | 'REVOKED';

export type VoucherSearchItem = {
  id: string;
  code: string;
  status: VoucherStatusX;
  batchId: string | null;
  planId: string;
  plan: { name: string; priceXof: number; durationMinutes: number };
  createdAt: string;
  usedAt: string | null;
  expiresAt: string | null;
};
export type VoucherSearchPage = { items: VoucherSearchItem[]; nextCursor: string | null };

export type VoucherReprint = {
  id: string;
  code: string;
  password: string;
  status: VoucherStatusX;
  plan: { name: string; priceXof: number; durationMinutes: number };
};

export type VoucherBatch = {
  id: string;
  seq: number;
  planId: string;
  routerId: string;
  quantity: number;
  generated: number;
  voucherCount: number;
  provisionedCount: number;
  status: 'PENDING' | 'GENERATING' | 'COMPLETED' | 'PARTIAL_SUCCESS' | 'FAILED';
  createdAt: string;
  completedAt: string | null;
  plan: { name: string; priceXof: number };
};

export type GenerateResult = {
  batchId: string;
  batchSeq: number;
  batchStatus: 'GENERATING' | 'COMPLETED' | 'PARTIAL_SUCCESS' | 'FAILED';
  pushedByServer: boolean;
  pushedCount: number;
  totalCount: number;
};

export type MetricsSummaryX = {
  period: string;
  revenueXof: number;
  ticketsGenerated: number;
  ticketsUsed: number;
  activeSessions: number;
  previousRevenueXof: number;
  trendPct: number | null;
  byPlan: {
    planId: string;
    planName: string;
    priceXof: number;
    sold: number;
    revenueXof: number;
  }[];
};

export type RecentClientX = {
  voucherId: string;
  code: string;
  status: VoucherStatusX;
  planName: string;
  priceXof: number;
  routerName: string;
  redeemedAt: string | null;
  macAddress: string | null;
  ipAddress: string | null;
  online: boolean;
};

// ── Helpers ──────────────────────────────────────────────────────────────────

export function isOnline(health: RouterHealth): boolean {
  return health === 'ONLINE';
}

export function healthLabel(health: RouterHealth): string {
  switch (health) {
    case 'ONLINE':
      return 'En ligne';
    case 'OFFLINE':
      return 'Hors ligne';
    case 'DEGRADED':
      return 'Dégradé';
    default:
      return 'Inconnu';
  }
}

export function fmtDuration(minutes: number): string {
  if (minutes <= 0) return '—';
  if (minutes % 1440 === 0) return `${minutes / 1440} j`;
  if (minutes % 60 === 0) return `${minutes / 60} h`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return h > 0 ? `${h} h ${m} min` : `${m} min`;
}

export function fmtBytesStr(value: string | null | undefined): string {
  let v = Number(value);
  if (!Number.isFinite(v)) v = 0;
  const units = ['o', 'Ko', 'Mo', 'Go', 'To'];
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i += 1;
  }
  return `${v.toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}

const VOUCHER_LABEL: Record<VoucherStatusX, string> = {
  GENERATED: 'Généré',
  ACTIVE: 'Actif',
  USED: 'Utilisé',
  EXPIRED: 'Expiré',
  REVOKED: 'Révoqué',
};
const VOUCHER_TONE: Record<VoucherStatusX, 'success' | 'warning' | 'danger' | 'muted' | 'primary'> = {
  GENERATED: 'primary',
  ACTIVE: 'success',
  USED: 'muted',
  EXPIRED: 'warning',
  REVOKED: 'danger',
};
export function VoucherStatusBadge({ status }: { status: VoucherStatusX }) {
  return <Badge tone={VOUCHER_TONE[status]}>{VOUCHER_LABEL[status]}</Badge>;
}

const BATCH_LABEL: Record<VoucherBatch['status'], string> = {
  PENDING: 'En attente',
  GENERATING: 'Génération…',
  COMPLETED: 'Terminé',
  PARTIAL_SUCCESS: 'Partiel',
  FAILED: 'Échec',
};
const BATCH_TONE: Record<VoucherBatch['status'], 'success' | 'warning' | 'danger' | 'muted' | 'primary'> = {
  PENDING: 'muted',
  GENERATING: 'primary',
  COMPLETED: 'success',
  PARTIAL_SUCCESS: 'warning',
  FAILED: 'danger',
};
export function BatchStatusBadge({ status }: { status: VoucherBatch['status'] }) {
  return <Badge tone={BATCH_TONE[status]}>{BATCH_LABEL[status]}</Badge>;
}

export function cpuFromResource(res: SystemResource | undefined): number | null {
  if (!res) return null;
  const raw = res['cpu-load'];
  if (raw == null || raw === '') return null;
  const n = Number(String(raw).replace('%', ''));
  return Number.isFinite(n) ? n : null;
}

export function memoryPercentFromResource(res: SystemResource | undefined): number | null {
  if (!res) return null;
  const total = Number(res['total-memory']);
  const free = res['free-memory'] === '' || res['free-memory'] == null ? NaN : Number(res['free-memory']);
  if (!Number.isFinite(total) || total <= 0 || !Number.isFinite(free)) return null;
  return Math.max(0, Math.min(100, Math.round(((total - free) / total) * 100)));
}

// ── Sous-navigation par onglets ──────────────────────────────────────────────

type Tab = { seg: string; label: string };
const TABS: Tab[] = [
  { seg: '', label: "Vue d'ensemble" },
  { seg: 'live', label: 'Live' },
  { seg: 'sessions', label: 'Sessions' },
  { seg: 'forfaits', label: 'Forfaits' },
  { seg: 'tickets', label: 'Tickets' },
  { seg: 'fichiers', label: 'Fichiers' },
  { seg: 'rapport', label: 'Rapport' },
  { seg: 'parametres', label: 'Paramètres' },
];

export function RouterTabs({ routerId }: { routerId: string }) {
  const pathname = usePathname();
  const base = `/routeurs/${routerId}`;
  return (
    <nav className="mb-6 flex gap-1 overflow-x-auto border-b border-border">
      {TABS.map((tab) => {
        const href = tab.seg ? `${base}/${tab.seg}` : base;
        const active = tab.seg ? pathname.startsWith(href) : pathname === base;
        return (
          <Link
            key={tab.seg || 'overview'}
            href={href}
            className={`whitespace-nowrap border-b-2 px-3 py-2.5 text-sm font-medium transition ${
              active
                ? 'border-primary text-primary'
                : 'border-transparent text-muted hover:text-fg'
            }`}
          >
            {tab.label}
          </Link>
        );
      })}
    </nav>
  );
}

export function RouterMetaBadges({ router }: { router: RouterItem }) {
  return (
    <div className="flex items-center gap-2 text-sm text-muted">
      <Dot online={isOnline(router.health)} />
      <span>{healthLabel(router.health)}</span>
      <span>·</span>
      <Badge tone={router.mode === 'REMOTE' ? 'primary' : 'muted'}>{router.mode}</Badge>
    </div>
  );
}

export function Select({
  label,
  children,
  value,
  onChange,
}: {
  label?: string;
  children: ReactNode;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <label className="block">
      {label && <span className="mb-1.5 block text-sm text-muted">{label}</span>}
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full rounded-xl border border-border bg-surface2 px-3.5 py-2.5 text-fg outline-none focus:border-primary"
      >
        {children}
      </select>
    </label>
  );
}
