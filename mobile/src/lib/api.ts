import axios, {
  AxiosError,
  AxiosHeaders,
  type AxiosInstance,
  type AxiosRequestConfig,
} from 'axios';
import {
  deleteStoredValue,
  getStoredValue,
  setStoredValue,
} from '@/src/lib/storage';
import { errorMessage } from '@/src/lib/errors';

const ACCESS_TOKEN_KEY = 'mikrolan_access_token';
const REFRESH_TOKEN_KEY = 'mikrolan_refresh_token';
const API_BASE_URL_KEY = 'mikrolan_api_base_url';

// Backend envelope: { success, data, message, error }
type ApiEnvelope<T> = {
  success: boolean;
  data: T;
  message: string | null;
  error: unknown;
};

export type AuthTokens = {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
};

export type UserRole = 'SUPER_ADMIN' | 'OWNER' | 'ADMIN' | 'MEMBER';
export type SubscriptionPlan = 'FREE' | 'PRO';
export type ManagementMode = 'LOCAL' | 'REMOTE';
export type RouterHealth = 'UNKNOWN' | 'ONLINE' | 'OFFLINE' | 'ERROR';

export type Me = {
  user: {
    id: string;
    email: string;
    name: string | null;
    country: string | null;
    role: UserRole;
    status: string;
    notificationsEnabled: boolean;
    hasPassword: boolean;
    googleId: string | null;
  };
  tenant: { id: string; name: string; slug: string; status: string };
  subscription: {
    plan: SubscriptionPlan;
    status: string;
    currentPeriodEnd: string | null;
  } | null;
  entitlement: Entitlement;
};

/**
 * Ce que le compte a le droit de faire, tel que le serveur le décide. L'app
 * dessine ses cadenas à partir d'ici — elle ne les invente pas.
 */
export type Entitlement = {
  tier: 'TRIAL' | 'PRO' | 'LOCKED';
  localAllowed: boolean;
  remoteAllowed: boolean;
  endsAt: string | null;
  daysLeft: number;
  /** Clé de la formule souscrite ; `null` en essai ou après retour au gratuit. */
  tierKey: string | null;
  /** Routeurs autorisés par la formule ; `null` = illimité. */
  routerLimit: number | null;
};

export type TicketTemplate = {
  showCompanyName: boolean;
  companyName?: string;
  showWifiName: boolean;
  showPrice: boolean;
  currency: string;
  showTicketNumber: boolean;
  showQrCode: boolean;
  showPlanName: boolean;
  showCreatedAt: boolean;
  showPoweredBy: boolean;
  showNote: boolean;
  note?: string;
  showHeader: boolean;
  header?: string;
  showFooter: boolean;
  footer?: string;
  showPageNumber: boolean;
  showLogo: boolean;
  logoDataUri?: string;
};

export const DEFAULT_TICKET_TEMPLATE: TicketTemplate = {
  showCompanyName: false,
  showWifiName: true,
  showPrice: true,
  currency: 'FCFA',
  showTicketNumber: true,
  showQrCode: true,
  showPlanName: true,
  showCreatedAt: true,
  showPoweredBy: true,
  showNote: true,
  note: 'Conservez le ticket pendant le service',
  showHeader: false,
  showFooter: false,
  showPageNumber: false,
  showLogo: false,
};

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
  createdAt: string;
  updatedAt: string;
};

export type RouterCredentials = { username: string; password: string };

export type ServicePorts = {
  webfigPort: number;
  sshPort: number;
  winboxPort: number;
};

export type ProvisionBundle = {
  routerId: string;
  wgIp: string;
  allocatedPort: number;
  serverPublicKey: string;
  endpoint: string;
  peerPublicKey: string;
  routerPrivateKey: string;
  webfigPort: number;
  sshPort: number;
  winboxPort: number;
};

export type RemoteAccessUrls = {
  webfig: { url: string; port: number };
  ssh: { host: string; port: number; command: string };
  winbox: { host: string; port: number; address: string };
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

export type PlanStatus = 'ACTIVE' | 'ARCHIVED';
export type PlanCodeFormat = 'ALPHANUMERIC' | 'NUMERIC';
export type Plan = {
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
export type PlanExpiration = 'ELAPSED' | 'RADIO_PAUSE';

export type MetricsPeriod = 'today' | '7d' | '30d';
// Liste fermée backend (revenue.service.ts) — audit/55 étape 6. Optionnel
// côté mobile : un backend pas encore mis à jour ne les envoie pas encore
// (transition de version, audit/55 étape 7), traité comme absence d'info.
export type RevenueDataQuality = 'EXACT' | 'ESTIMATED' | 'MIXED' | 'INCOMPLETE' | 'NO_DATA';
export type PlanBreakdown = {
  planId: string;
  planName: string;
  priceXof: number;
  sold: number;
  revenueXof: number;
  exactRevenueXof?: number;
  estimatedRevenueXof?: number;
  unknownSalesCount?: number;
  invalidSourceCount?: number;
  dataQuality?: RevenueDataQuality;
};
export type MetricsSummary = {
  period: MetricsPeriod;
  revenueXof: number;
  ticketsGenerated: number;
  ticketsUsed: number;
  activeSessions: number;
  previousRevenueXof: number;
  trendPct: number | null;
  byPlan: PlanBreakdown[];
  // Champs additifs (audit/55) — absents si le backend appelé est plus
  // ancien que cette version mobile ; toujours lus avec un repli défensif.
  exactRevenueXof?: number;
  estimatedRevenueXof?: number;
  unknownSalesCount?: number;
  invalidSourceCount?: number;
  dataQuality?: RevenueDataQuality;
};

export type RecentClient = {
  voucherId: string;
  code: string;
  status: VoucherStatus;
  planName: string;
  priceXof: number;
  routerName: string;
  redeemedAt: string | null;
  macAddress: string | null;
  ipAddress: string | null;
  online: boolean;
};

export type AppNotification = {
  id: string;
  type: string;
  title: string;
  body: string;
  voucherId: string | null;
  routerId: string | null;
  read: boolean;
  createdAt: string;
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

export type VoucherStatus =
  | 'GENERATED'
  | 'ACTIVE'
  | 'USED'
  | 'EXPIRED'
  | 'REVOKED';
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
};

export type VoucherLookupResult = VoucherItem & {
  plan: {
    id: string;
    name: string;
    priceXof: number;
    durationMinutes: number;
  } | null;
};

export type RevenueByPeriodItem = {
  month: string;
  year: number;
  monthNum: number;
  totalXof: number;
  transactionCount: number;
  exactXof?: number;
  estimatedXof?: number;
  unknownSalesCount?: number;
  invalidSourceCount?: number;
  dataQuality?: RevenueDataQuality;
};

export type RevenueByRouterItem = {
  routerId: string;
  routerName: string;
  totalXof: number;
  transactionCount: number;
  exactXof?: number;
  estimatedXof?: number;
  unknownSalesCount?: number;
  invalidSourceCount?: number;
  dataQuality?: RevenueDataQuality;
};

// Module Analytics/BI — audit/67. Périodes nommées identiques au backend
// (analytics/dto/analytics.schemas.ts) ; jamais de tenantId côté client.
export type AnalyticsPeriod =
  | 'today'
  | 'yesterday'
  | 'last7days'
  | 'last30days'
  | 'currentWeek'
  | 'currentMonth'
  | 'custom';

export type AnalyticsFilters = {
  period: AnalyticsPeriod;
  from?: string;
  to?: string;
  routerId?: string;
  planId?: string;
};

export type AnalyticsRouterSummary = {
  routerId: string;
  routerName: string;
  revenueXof: number;
  exactRevenueXof: number;
  estimatedRevenueXof: number;
  salesCount: number;
  averageSaleXof: number;
  contributionPercent: number;
  growthPercent: number | null;
  dataQuality: RevenueDataQuality;
};

export type AnalyticsPlanPerformance = {
  planId: string;
  name: string;
  salesCount: number;
  revenueXof: number;
  exactRevenueXof: number;
  estimatedRevenueXof: number;
  revenueContributionPercent: number;
  salesContributionPercent: number;
  averageSaleXof: number;
  routerCount: number;
  growthPercent: number | null;
  dataQuality: RevenueDataQuality;
};

export type AnalyticsHeatmapCell = {
  dayOfWeek: number; // 0=lundi..6=dimanche
  hour: number; // 0-23
  count: number;
  revenueXof?: number; // uniquement salesHeatmap
};

export type AnalyticsOverview = {
  period: { from: string; to: string };
  timezone: string;
  revenueXof: number;
  exactRevenueXof: number;
  estimatedRevenueXof: number;
  salesCount: number;
  averageSaleXof: number;
  unknownSalesCount: number;
  invalidSourceCount: number;
  dataQuality: RevenueDataQuality;
  previousPeriod: { from: string; to: string };
  revenueGrowthPercent: number | null;
  salesGrowthPercent: number | null;
  routersSummary: AnalyticsRouterSummary[];
  topPlans: AnalyticsPlanPerformance[];
  lastCalculatedAt: string;
};

export type AnalyticsRouterDetail = {
  routerId: string;
  routerName: string;
  health: string | null;
  period: { from: string; to: string };
  timezone: string;
  revenueXof: number;
  exactRevenueXof: number;
  estimatedRevenueXof: number;
  salesCount: number;
  averageSaleXof: number;
  unknownSalesCount: number;
  invalidSourceCount: number;
  dataQuality: RevenueDataQuality;
  contributionPercent: number;
  growthPercent: number | null;
  plans: {
    planId: string;
    name: string;
    salesCount: number;
    revenueXof: number;
    exactRevenueXof: number;
    estimatedRevenueXof: number;
    dataQuality: RevenueDataQuality;
  }[];
  timeSeries: { date: string; revenueXof: number; salesCount: number }[];
  salesHeatmap: AnalyticsHeatmapCell[];
  sessionsHeatmap: AnalyticsHeatmapCell[];
  sessionsCount: number;
  comparisonToTenantAverage: { averageRouterRevenueXof: number; deltaPercent: number | null };
  lastCalculatedAt: string;
};

export type AnalyticsTraffic = {
  period: { from: string; to: string };
  timezone: string;
  salesHeatmap: AnalyticsHeatmapCell[];
  sessionsHeatmap: AnalyticsHeatmapCell[];
};

// Prévisions BI explicables — audit/73. Liste fermée backend
// (forecast.types.ts) : jamais HIGH par intuition, INSUFFICIENT_DATA
// systématique sous les seuils.
export type ForecastConfidence = 'HIGH' | 'MEDIUM' | 'LOW' | 'INSUFFICIENT_DATA' | 'UNAVAILABLE';
export type ForecastModelName =
  | 'NAIVE'
  | 'MOVING_AVERAGE_7'
  | 'MOVING_AVERAGE_14'
  | 'MOVING_AVERAGE_28'
  | 'WEEKDAY_SEASONAL'
  | 'LINEAR_TREND';

export type ForecastPoint = {
  date: string;
  predicted: number;
  lowerBound: number;
  upperBound: number;
};

export type ForecastResult = {
  metric: 'revenueXof' | 'salesCount';
  points: ForecastPoint[];
  model: ForecastModelName;
  confidence: ForecastConfidence;
  historyStart: string | null;
  historyEnd: string | null;
  trainingPoints: number;
  validationMetric: { mae: number; wape: number | null; bias: number } | null;
  modelComparison: { model: ForecastModelName; mae: number; wape: number | null; bias: number }[];
  calculatedAt: string;
  isForecast: true;
  warnings: string[];
};

export type ForecastOverview = {
  revenueForecast: ForecastResult;
  salesForecast: ForecastResult;
  warnings: string[];
};

export type ForecastTraffic = {
  salesPeakDays: { dayOfWeek: number; averageCount: number }[];
  salesPeakHours: { hour: number; averageCount: number }[];
  sessionsPeakDays: { dayOfWeek: number; averageCount: number }[];
  sessionsPeakHours: { hour: number; averageCount: number }[];
  confidence: ForecastConfidence;
  historyCoverageDays: number;
  insufficientDataReason: string | null;
  calculatedAt: string;
};

export type RouterForecastItem = {
  routerId: string;
  routerName: string;
  currentTrend: 'UP' | 'DOWN' | 'STABLE' | 'UNKNOWN';
  expectedDirection: 'UP' | 'DOWN' | 'STABLE' | 'UNKNOWN';
  forecastRevenueXof: number | null;
  forecastSalesCount: number | null;
  confidence: ForecastConfidence;
  warning: string | null;
};

export type PlanForecastItem = {
  planId: string;
  name: string;
  salesTrend: 'UP' | 'DOWN' | 'STABLE' | 'UNKNOWN';
  revenueTrend: 'UP' | 'DOWN' | 'STABLE' | 'UNKNOWN';
  expectedDemand: number | null;
  confidence: ForecastConfidence;
  warning: string | null;
};

export type BusinessInsight = {
  type: string;
  title: string;
  observation: string;
  evidence: string;
  period: { from: string; to: string };
  confidence: ForecastConfidence;
  recommendedAction: string | null;
  limitations: string;
};

export type InvoiceItem = {
  id: string;
  number: string;
  status: 'DRAFT' | 'SENT' | 'PAID' | 'OVERDUE';
  subtotalXof: number;
  taxXof: number;
  totalXof: number;
  periodStart: string;
  periodEnd: string;
  dueDate: string | null;
  createdAt: string;
};

export type VoucherSessionInfo = {
  status: 'ACTIVE' | 'TERMINATED' | 'EXPIRED';
  startedAt: string;
  lastSeenAt: string | null;
  terminatedAt: string | null;
  bytesIn: string;
  bytesOut: string;
  macAddress: string | null;
  ipAddress: string | null;
};

export type VoucherVerificationResult = {
  source: 'SAAS' | 'LEGACY';
  voucherId: string | null;
  routerId: string | null;
  code: string;
  status: VoucherStatus;
  canLogin: boolean;
  planName: string;
  durationMinutes: number;
  priceXof: number;
  routerName: string | null;
  deliveredAt: string | null;
  activatedAt: string | null;
  expiresAt: string | null;
  session: VoucherSessionInfo | null;
  message: string;
  advice: string;
};

export type UserProfile = {
  id: string;
  name: string;
  sharedUsers: number;
  rateLimit: string | null;
};

export type HotspotServer = { id: string; name: string; interface: string };
export type HotspotSettings = {
  idleTimeoutMinutes: number | null;
  dnsName: string | null;
};

export type IpBindingType = 'bypassed' | 'blocked' | 'regular';
export type IpBinding = {
  id: string;
  macAddress: string;
  ipAddress?: string;
  server?: string;
  type: IpBindingType;
  comment?: string;
};
export type CreateIpBindingPayload = {
  macAddress: string;
  ipAddress?: string;
  server?: string;
  type: IpBindingType;
  comment?: string;
};

export type VoucherBatchStatus =
  | 'PENDING'
  | 'GENERATING'
  | 'COMPLETED'
  | 'FAILED';
export type VoucherBatch = {
  id: string;
  planId: string;
  routerId: string;
  quantity: number;
  generated: number;
  status: VoucherBatchStatus;
  createdAt: string;
  completedAt: string | null;
  plan: { name: string; priceXof: number };
};

export type LiveSession = {
  id: string; // RouterOS .id
  user: string;
  ipAddress: string | null;
  macAddress: string | null;
  bytesIn: string;
  bytesOut: string;
  uptime: string | null;
};

// RouterOS push params returned for LOCAL routers so the app pushes over the LAN.
export type VoucherPushParams = {
  userProfile: string;
  rateLimit?: string;
  sharedUsers?: number;
  limitUptime: string;
  limitBytesTotal?: number;
  comment: string;
};

export type GenerateResult = {
  batchId: string;
  pushedByServer: boolean;
  push?: VoucherPushParams;
  vouchers: VoucherItem[];
};

export type CreateRouterPayload = {
  identity: string;
  alias?: string;
  model?: string;
  localAddress?: string;
  mode?: ManagementMode;
  credentials?: RouterCredentials;
};

export type UpdateRouterPayload = {
  alias?: string | null;
  model?: string | null;
  localAddress?: string | null;
  mode?: ManagementMode;
  credentials?: RouterCredentials | null;
  pushNotifications?: boolean;
};

const DEFAULT_API_BASE_URL =
  process.env.EXPO_PUBLIC_API_BASE_URL?.trim() ||
  (__DEV__ ? 'http://10.0.2.2:3001/api' : 'https://api.mikrolan.net/api');

let apiBaseUrl = normalizeApiBaseUrl(DEFAULT_API_BASE_URL);
let accessToken: string | null = null;
let refreshToken: string | null = null;

type ApiEvents = {
  onUnauthorized?: () => void;
  onTokensChanged?: (tokens: AuthTokens | null) => void;
};
const apiEvents: ApiEvents = {};
let refreshInFlight: Promise<AuthTokens | null> | null = null;

function looksLikeIpOrLocalhost(value: string): boolean {
  return /^(localhost|\d{1,3}(?:\.\d{1,3}){3})(:\d+)?(?:\/|$)/i.test(value);
}

export function normalizeApiBaseUrl(input: string): string {
  const raw = input.trim();
  if (!raw) return normalizeApiBaseUrl(DEFAULT_API_BASE_URL);

  const withProtocol = /^https?:\/\//i.test(raw)
    ? raw
    : __DEV__ && looksLikeIpOrLocalhost(raw)
      ? `http://${raw}`
      : `https://${raw}`;

  const parsed = new URL(withProtocol);
  let pathname = parsed.pathname.replace(/\/+$/, '');
  if (!pathname) pathname = '/api';
  parsed.pathname = pathname;
  parsed.search = '';
  parsed.hash = '';
  return parsed.toString().replace(/\/$/, '');
}

async function persistTokens(tokens: AuthTokens | null): Promise<void> {
  if (!tokens) {
    await deleteStoredValue(ACCESS_TOKEN_KEY);
    await deleteStoredValue(REFRESH_TOKEN_KEY);
    return;
  }
  await setStoredValue(ACCESS_TOKEN_KEY, tokens.accessToken);
  await setStoredValue(REFRESH_TOKEN_KEY, tokens.refreshToken);
}

export async function bootstrapApiState(): Promise<void> {
  const [storedBaseUrl, storedAccess, storedRefresh] = await Promise.all([
    getStoredValue(API_BASE_URL_KEY),
    getStoredValue(ACCESS_TOKEN_KEY),
    getStoredValue(REFRESH_TOKEN_KEY),
  ]);
  if (storedBaseUrl) {
    const normalized = normalizeApiBaseUrl(storedBaseUrl);
    // A stored URL surviving an overwrite install (SecureStore isn't cleared
    // unless the app is fully uninstalled) can point at a retired VPS/port
    // from a previous migration. In production there is only one valid host,
    // so anything else is stale by definition — no need to enumerate every
    // past bad value. __DEV__ keeps its stored value untouched since the
    // debug URL field intentionally targets emulator/LAN hosts.
    const stale =
      !__DEV__ &&
      new URL(normalized).host !== new URL(normalizeApiBaseUrl(DEFAULT_API_BASE_URL)).host;
    apiBaseUrl = stale ? normalizeApiBaseUrl(DEFAULT_API_BASE_URL) : normalized;
    if (stale) await deleteStoredValue(API_BASE_URL_KEY);
  }
  accessToken = storedAccess;
  refreshToken = storedRefresh;
}

export function setApiEventHandlers(handlers: ApiEvents): void {
  apiEvents.onUnauthorized = handlers.onUnauthorized;
  apiEvents.onTokensChanged = handlers.onTokensChanged;
}

export function getApiBaseUrl(): string {
  return apiBaseUrl;
}

export async function setApiBaseUrl(nextBaseUrl: string): Promise<string> {
  const normalized = normalizeApiBaseUrl(nextBaseUrl);
  apiBaseUrl = normalized;
  await setStoredValue(API_BASE_URL_KEY, normalized);
  return normalized;
}

export function getAuthTokens(): AuthTokens | null {
  if (!accessToken || !refreshToken) return null;
  return { accessToken, refreshToken, expiresIn: 0 };
}

export async function setAuthTokens(tokens: AuthTokens): Promise<void> {
  accessToken = tokens.accessToken;
  refreshToken = tokens.refreshToken;
  await persistTokens(tokens);
  apiEvents.onTokensChanged?.(tokens);
}

export async function clearAuthTokens(triggerUnauthorized = false): Promise<void> {
  accessToken = null;
  refreshToken = null;
  await persistTokens(null);
  apiEvents.onTokensChanged?.(null);
  if (triggerUnauthorized) apiEvents.onUnauthorized?.();
}

function unwrap<T>(response: { data: ApiEnvelope<T> }): T {
  return response.data.data;
}

async function refreshTokens(): Promise<AuthTokens | null> {
  if (!refreshToken) return null;
  try {
    const response = await axios.post<ApiEnvelope<AuthTokens>>(
      `${apiBaseUrl}/auth/refresh`,
      { refreshToken },
      { timeout: 15000, headers: { 'Content-Type': 'application/json' } },
    );
    const next = unwrap(response);
    await setAuthTokens(next);
    return next;
  } catch {
    await clearAuthTokens(true);
    return null;
  }
}

type RetryableConfig = AxiosRequestConfig & { _retry?: boolean };

const apiClient: AxiosInstance = axios.create({
  timeout: 15000,
  headers: { 'Content-Type': 'application/json' },
});

apiClient.interceptors.request.use((config) => {
  config.baseURL = apiBaseUrl;
  if (!config.headers) config.headers = new AxiosHeaders();
  if (accessToken) config.headers.Authorization = `Bearer ${accessToken}`;
  return config;
});

apiClient.interceptors.response.use(
  (response) => response,
  async (error: AxiosError) => {
    const original = error.config as RetryableConfig | undefined;
    if (
      error.response?.status === 401 &&
      original &&
      !original._retry &&
      refreshToken
    ) {
      original._retry = true;
      refreshInFlight ??= refreshTokens();
      const refreshed = await refreshInFlight;
      refreshInFlight = null;
      if (!refreshed) return Promise.reject(error);
      original.headers = original.headers ?? {};
      (original.headers as Record<string, string>).Authorization =
        `Bearer ${refreshed.accessToken}`;
      return apiClient(original);
    }
    if (error.response?.status === 401) await clearAuthTokens(true);
    return Promise.reject(error);
  },
);

export const api = {
  auth: {
    async signup(
      tenantName: string,
      email: string,
      password: string,
    ): Promise<AuthTokens> {
      const res = await apiClient.post<ApiEnvelope<AuthTokens>>('/auth/signup', {
        tenantName,
        email,
        password,
      });
      return unwrap(res);
    },
    async login(email: string, password: string): Promise<AuthTokens> {
      const res = await apiClient.post<ApiEnvelope<AuthTokens>>('/auth/login', {
        email,
        password,
      });
      return unwrap(res);
    },
    async googleLogin(idToken: string, nonce?: string): Promise<AuthTokens> {
      const res = await apiClient.post<ApiEnvelope<AuthTokens>>('/auth/google', {
        idToken,
        ...(nonce ? { nonce } : {}),
      });
      return unwrap(res);
    },
    async appleLogin(
      identityToken: string,
      nonce?: string,
      fullName?: string,
    ): Promise<AuthTokens> {
      const res = await apiClient.post<ApiEnvelope<AuthTokens>>('/auth/apple', {
        identityToken,
        ...(nonce ? { nonce } : {}),
        ...(fullName ? { fullName } : {}),
      });
      return unwrap(res);
    },
    async me(): Promise<Me> {
      const res = await apiClient.get<ApiEnvelope<Me>>('/auth/me');
      return unwrap(res);
    },
    async updateProfile(payload: {
      name?: string | null;
      country?: string | null;
    }): Promise<Me['user']> {
      const res = await apiClient.patch<ApiEnvelope<Me['user']>>(
        '/auth/me',
        payload,
      );
      return unwrap(res);
    },
    async changePassword(
      currentPassword: string,
      newPassword: string,
    ): Promise<void> {
      await apiClient.post('/auth/change-password', {
        currentPassword,
        newPassword,
      });
    },
    async logout(): Promise<void> {
      if (!refreshToken) return;
      await apiClient.post('/auth/logout', { refreshToken });
    },
    async updateNotifications(enabled: boolean): Promise<void> {
      await apiClient.patch('/auth/me/notifications', { enabled });
    },
    async logoutAllSessions(): Promise<void> {
      await apiClient.post('/auth/logout-all');
    },
    async setPassword(password: string): Promise<void> {
      await apiClient.post('/auth/set-password', { password });
    },
    async deleteAccount(opts: { password?: string; googleIdToken?: string }): Promise<void> {
      await apiClient.delete('/auth/me', { data: opts });
    },
    async registerPushToken(token: string): Promise<void> {
      await apiClient.post('/auth/push-token', { token });
    },
    async requestPasswordReset(email: string): Promise<void> {
      await apiClient.post('/auth/password-reset/request', { email });
    },
    async confirmPasswordReset(
      email: string,
      code: string,
      newPassword: string,
    ): Promise<void> {
      await apiClient.post('/auth/password-reset/confirm', {
        email,
        code,
        newPassword,
      });
    },
  },

  routers: {
    async list(): Promise<RouterItem[]> {
      const res = await apiClient.get<ApiEnvelope<RouterItem[]>>('/routers');
      return unwrap(res);
    },
    async get(id: string): Promise<RouterItem> {
      const res = await apiClient.get<ApiEnvelope<RouterItem>>(`/routers/${id}`);
      return unwrap(res);
    },
    async create(payload: CreateRouterPayload): Promise<RouterItem> {
      const res = await apiClient.post<ApiEnvelope<RouterItem>>(
        '/routers',
        payload,
      );
      return unwrap(res);
    },
    async update(id: string, payload: UpdateRouterPayload): Promise<RouterItem> {
      const res = await apiClient.patch<ApiEnvelope<RouterItem>>(
        `/routers/${id}`,
        payload,
      );
      return unwrap(res);
    },
    async remove(id: string): Promise<{ deleted: boolean }> {
      const res = await apiClient.delete<ApiEnvelope<{ deleted: boolean }>>(
        `/routers/${id}`,
      );
      return unwrap(res);
    },
    async updateTicketTemplate(
      id: string,
      template: TicketTemplate,
    ): Promise<RouterItem> {
      const res = await apiClient.patch<ApiEnvelope<RouterItem>>(
        `/routers/${id}/ticket-template`,
        template,
      );
      return unwrap(res);
    },
    async remoteStatus(id: string): Promise<RemoteStatus> {
      const res = await apiClient.get<ApiEnvelope<RemoteStatus>>(
        `/routers/${id}/remote`,
      );
      return unwrap(res);
    },
    async remoteSystemResource(id: string): Promise<Record<string, string>> {
      const res = await apiClient.get<ApiEnvelope<Record<string, string>>>(
        `/routers/${id}/remote/system-resource`,
      );
      return unwrap(res);
    },
    async provisionRemote(
      id: string,
      servicePorts?: Partial<ServicePorts>,
    ): Promise<ProvisionBundle> {
      const res = await apiClient.post<ApiEnvelope<ProvisionBundle>>(
        `/routers/${id}/remote/provision`,
        servicePorts ?? {},
      );
      return unwrap(res);
    },
    async revokeRemote(id: string): Promise<{ revoked: boolean }> {
      const res = await apiClient.post<ApiEnvelope<{ revoked: boolean }>>(
        `/routers/${id}/remote/revoke`,
      );
      return unwrap(res);
    },
    async rebootRemote(id: string): Promise<{ rebooted: boolean }> {
      const res = await apiClient.post<ApiEnvelope<{ rebooted: boolean }>>(
        `/routers/${id}/remote/reboot`,
      );
      return unwrap(res);
    },
    async configureHotspot(
      id: string,
      payload: { interface: string; network?: string; dns?: string },
    ): Promise<{ configured: boolean; gateway: string; network: string }> {
      const res = await apiClient.post<
        ApiEnvelope<{ configured: boolean; gateway: string; network: string }>
      >(`/routers/${id}/hotspot/configure`, payload);
      return unwrap(res);
    },
    async listUserProfiles(id: string): Promise<UserProfile[]> {
      const res = await apiClient.get<ApiEnvelope<UserProfile[]>>(
        `/routers/${id}/hotspot/user-profiles`,
      );
      return unwrap(res);
    },
    async updateUserProfile(
      id: string,
      profileId: string,
      patch: { name?: string; sharedUsers?: number; rateLimit?: string | null },
    ): Promise<{ updated: boolean }> {
      const res = await apiClient.patch<ApiEnvelope<{ updated: boolean }>>(
        `/routers/${id}/hotspot/user-profiles/${encodeURIComponent(profileId)}`,
        patch,
      );
      return unwrap(res);
    },
    async deleteUserProfile(
      id: string,
      profileId: string,
    ): Promise<{ deleted: boolean }> {
      const res = await apiClient.delete<ApiEnvelope<{ deleted: boolean }>>(
        `/routers/${id}/hotspot/user-profiles/${encodeURIComponent(profileId)}`,
      );
      return unwrap(res);
    },
    async listHotspotServers(id: string): Promise<HotspotServer[]> {
      const res = await apiClient.get<ApiEnvelope<HotspotServer[]>>(
        `/routers/${id}/hotspot/servers`,
      );
      return unwrap(res);
    },
    async listIpBindings(id: string): Promise<IpBinding[]> {
      const res = await apiClient.get<ApiEnvelope<IpBinding[]>>(
        `/routers/${id}/hotspot/ip-bindings`,
      );
      return unwrap(res);
    },
    async addIpBinding(
      id: string,
      payload: CreateIpBindingPayload,
    ): Promise<IpBinding> {
      const res = await apiClient.post<ApiEnvelope<IpBinding>>(
        `/routers/${id}/hotspot/ip-bindings`,
        payload,
      );
      return unwrap(res);
    },
    async updateIpBinding(
      id: string,
      bindingId: string,
      payload: Partial<CreateIpBindingPayload>,
    ): Promise<IpBinding> {
      const res = await apiClient.patch<ApiEnvelope<IpBinding>>(
        `/routers/${id}/hotspot/ip-bindings/${bindingId}`,
        payload,
      );
      return unwrap(res);
    },
    async removeIpBinding(
      id: string,
      bindingId: string,
    ): Promise<{ removed: boolean }> {
      const res = await apiClient.delete<ApiEnvelope<{ removed: boolean }>>(
        `/routers/${id}/hotspot/ip-bindings/${bindingId}`,
      );
      return unwrap(res);
    },
    async getInternetSharing(id: string): Promise<{ blocked: boolean }> {
      const res = await apiClient.get<ApiEnvelope<{ blocked: boolean }>>(
        `/routers/${id}/hotspot/internet-sharing`,
      );
      return unwrap(res);
    },
    async setInternetSharing(
      id: string,
      blocked: boolean,
    ): Promise<{ blocked: boolean }> {
      const res = await apiClient.post<ApiEnvelope<{ blocked: boolean }>>(
        `/routers/${id}/hotspot/internet-sharing`,
        { blocked },
      );
      return unwrap(res);
    },
    async getHotspotSettings(
      id: string,
      server = 'hotspot1',
    ): Promise<HotspotSettings> {
      const res = await apiClient.get<ApiEnvelope<HotspotSettings>>(
        `/routers/${id}/hotspot/settings`,
        { params: { server } },
      );
      return unwrap(res);
    },
    async updateHotspotSettings(
      id: string,
      payload: {
        server?: string;
        idleTimeoutMinutes?: number | null;
        dnsName?: string | null;
      },
    ): Promise<HotspotSettings> {
      const res = await apiClient.patch<ApiEnvelope<HotspotSettings>>(
        `/routers/${id}/hotspot/settings`,
        payload,
      );
      return unwrap(res);
    },
    async generateVouchers(
      id: string,
      payload: { planId: string; quantity: number },
    ): Promise<GenerateResult> {
      const res = await apiClient.post<ApiEnvelope<GenerateResult>>(
        `/routers/${id}/vouchers/generate`,
        payload,
      );
      return unwrap(res);
    },
    async confirmVouchers(
      id: string,
      payload: {
        batchId: string;
        items: { id: string; mikrotikId: string }[];
      },
    ): Promise<{ confirmed: number }> {
      const res = await apiClient.post<ApiEnvelope<{ confirmed: number }>>(
        `/routers/${id}/vouchers/confirm`,
        payload,
      );
      return unwrap(res);
    },
    async listVouchers(
      id: string,
      params?: { status?: VoucherStatus; batchId?: string },
    ): Promise<VoucherItem[]> {
      const res = await apiClient.get<ApiEnvelope<VoucherItem[]>>(
        `/routers/${id}/vouchers`,
        { params },
      );
      return unwrap(res);
    },
    // Recherche unitaire par code — n'est pas soumise au plafond des 500
    // derniers tickets de `listVouchers`, donc reste correcte pour un ticket
    // ancien présenté au comptoir.
    async lookupVoucher(id: string, code: string): Promise<VoucherLookupResult> {
      const res = await apiClient.get<ApiEnvelope<VoucherLookupResult>>(
        `/routers/${id}/vouchers/lookup`,
        { params: { code } },
      );
      return unwrap(res);
    },
    async listBatches(id: string): Promise<VoucherBatch[]> {
      const res = await apiClient.get<ApiEnvelope<VoucherBatch[]>>(
        `/routers/${id}/vouchers/batches`,
      );
      return unwrap(res);
    },
    // Suppression définitive — pas de corbeille, le ticket/lot disparaît
    // partout (DB + hotspot RouterOS si joignable), sans limite de statut.
    async deleteBatch(id: string, batchId: string): Promise<{ deleted: boolean }> {
      const res = await apiClient.delete<ApiEnvelope<{ deleted: boolean }>>(
        `/routers/${id}/vouchers/batches/${batchId}`,
      );
      return unwrap(res);
    },
    async revokeVoucher(
      id: string,
      voucherId: string,
    ): Promise<{ revoked: boolean }> {
      const res = await apiClient.post<ApiEnvelope<{ revoked: boolean }>>(
        `/routers/${id}/vouchers/${voucherId}/revoke`,
      );
      return unwrap(res);
    },
    async deleteVoucher(
      id: string,
      voucherId: string,
    ): Promise<{ deleted: boolean }> {
      const res = await apiClient.delete<ApiEnvelope<{ deleted: boolean }>>(
        `/routers/${id}/vouchers/${voucherId}`,
      );
      return unwrap(res);
    },
    async listSessions(id: string): Promise<LiveSession[]> {
      const res = await apiClient.get<ApiEnvelope<LiveSession[]>>(
        `/routers/${id}/sessions`,
      );
      return unwrap(res);
    },
    async terminateSession(
      id: string,
      mikrotikId: string,
    ): Promise<{ terminated: boolean }> {
      const res = await apiClient.post<ApiEnvelope<{ terminated: boolean }>>(
        `/routers/${id}/sessions/terminate`,
        { mikrotikId },
      );
      return unwrap(res);
    },
    // LOCAL routers: the server can't reach a private LAN, so we report what we
    // read on the router ourselves. This is what turns a used ticket into
    // revenue — without it a free operator's reporting stays at zero.
    async syncSessions(
      id: string,
      active: LiveSession[],
    ): Promise<{ synced: number }> {
      const res = await apiClient.post<ApiEnvelope<{ synced: number }>>(
        `/routers/${id}/sessions/sync`,
        { active },
      );
      return unwrap(res);
    },
  },

  notifications: {
    async list(unreadOnly = false, limit = 30): Promise<AppNotification[]> {
      const res = await apiClient.get<ApiEnvelope<AppNotification[]>>(
        '/notifications',
        { params: { unreadOnly: String(unreadOnly), limit } },
      );
      return unwrap(res);
    },
    async unreadCount(): Promise<number> {
      const res = await apiClient.get<ApiEnvelope<{ count: number }>>(
        '/notifications/unread-count',
      );
      return unwrap(res).count;
    },
    async markRead(id: string): Promise<void> {
      await apiClient.patch(`/notifications/${id}/read`);
    },
    async markAllRead(): Promise<void> {
      await apiClient.patch('/notifications/read-all');
    },
  },

  metrics: {
    async summary(
      period: MetricsPeriod = '30d',
      routerId?: string,
    ): Promise<MetricsSummary> {
      const res = await apiClient.get<ApiEnvelope<MetricsSummary>>(
        '/metrics/summary',
        { params: { period, ...(routerId ? { routerId } : {}) } },
      );
      return unwrap(res);
    },
    async recentClients(
      limit = 30,
      routerId?: string,
    ): Promise<RecentClient[]> {
      const res = await apiClient.get<ApiEnvelope<RecentClient[]>>(
        '/metrics/clients',
        { params: { limit, ...(routerId ? { routerId } : {}) } },
      );
      return unwrap(res);
    },
  },

  plans: {
    async list(routerId: string): Promise<Plan[]> {
      const res = await apiClient.get<ApiEnvelope<Plan[]>>(
        `/routers/${routerId}/plans`,
      );
      return unwrap(res);
    },
    async create(routerId: string, payload: CreatePlanPayload): Promise<Plan> {
      const res = await apiClient.post<ApiEnvelope<Plan>>(
        `/routers/${routerId}/plans`,
        payload,
      );
      return unwrap(res);
    },
    async update(
      routerId: string,
      planId: string,
      payload: UpdatePlanPayload,
    ): Promise<Plan> {
      const res = await apiClient.patch<ApiEnvelope<Plan>>(
        `/routers/${routerId}/plans/${planId}`,
        payload,
      );
      return unwrap(res);
    },
    async remove(
      routerId: string,
      planId: string,
    ): Promise<{ deleted: boolean }> {
      const res = await apiClient.delete<ApiEnvelope<{ deleted: boolean }>>(
        `/routers/${routerId}/plans/${planId}`,
      );
      return unwrap(res);
    },
  },

  subscriptions: {
    /** Grille tarifaire publiée par le super admin. */
    async tiers(): Promise<Tier[]> {
      const res = await apiClient.get<ApiEnvelope<Tier[]>>('/subscriptions/tiers');
      return unwrap(res);
    },
    async requestUpgrade(payload: {
      note?: string;
      tierKey?: string;
      billingPeriod?: BillingPeriod;
    }): Promise<UpgradeRequestResult> {
      const res = await apiClient.post<ApiEnvelope<UpgradeRequestResult>>(
        '/subscriptions/request-upgrade',
        payload,
      );
      return unwrap(res);
    },

    async paymentInfo(): Promise<PaymentInfo> {
      const res = await apiClient.get<ApiEnvelope<PaymentInfo>>(
        '/subscriptions/payment-info',
      );
      return unwrap(res);
    },
    async uploadProof(
      invoiceId: string,
      method: 'WAVE' | 'ORANGE_MONEY',
      imageUri: string,
      note?: string,
    ): Promise<{ proof: { id: string }; message: string }> {
      const form = new FormData();
      form.append('invoiceId', invoiceId);
      form.append('method', method);
      if (note) form.append('note', note);
      form.append('image', {
        uri: imageUri,
        type: 'image/jpeg',
        name: 'proof.jpg',
      } as unknown as Blob);
      const res = await apiClient.post<
        ApiEnvelope<{ proof: { id: string }; message: string }>
      >('/subscriptions/upload-proof', form, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      return unwrap(res);
    },

    // ── Plateforme (SUPER_ADMIN) ────────────────────────────
    // Le serveur refuse ces deux routes à tout autre rôle ; l'app se contente
    // de ne pas les proposer, elle ne les autorise pas.
    async activate(
      tenantId: string,
      periodDays: number,
    ): Promise<TenantSubscription> {
      const res = await apiClient.post<ApiEnvelope<TenantSubscription>>(
        `/subscriptions/${tenantId}/activate`,
        { periodDays },
      );
      return unwrap(res);
    },
    async deactivate(tenantId: string): Promise<TenantSubscription> {
      const res = await apiClient.post<ApiEnvelope<TenantSubscription>>(
        `/subscriptions/${tenantId}/deactivate`,
        {},
      );
      return unwrap(res);
    },
  },

  // ── Back-office plateforme (SUPER_ADMIN) ────────────────
  // Le serveur ferme ces routes à tout autre rôle (403) ; l'application se
  // contente de ne pas les afficher.
  admin: {
    async metrics(): Promise<PlatformMetrics> {
      const res = await apiClient.get<ApiEnvelope<PlatformMetrics>>('/admin/metrics');
      return unwrap(res);
    },
    async tenants(
      params: { q?: string; cursor?: string; limit?: number } = {},
    ): Promise<Page<AdminTenant>> {
      const res = await apiClient.get<ApiEnvelope<Page<AdminTenant>>>(
        '/admin/tenants',
        { params },
      );
      return unwrap(res);
    },
    async tenant(id: string): Promise<AdminTenantDetail> {
      const res = await apiClient.get<ApiEnvelope<AdminTenantDetail>>(
        `/admin/tenants/${id}`,
      );
      return unwrap(res);
    },
    async setTenantStatus(
      id: string,
      status: 'ACTIVE' | 'SUSPENDED',
      reason?: string,
    ): Promise<{ id: string; name: string; status: TenantStatus }> {
      const res = await apiClient.patch<
        ApiEnvelope<{ id: string; name: string; status: TenantStatus }>
      >(`/admin/tenants/${id}/status`, { status, ...(reason ? { reason } : {}) });
      return unwrap(res);
    },
    async users(
      params: { q?: string; tenantId?: string; cursor?: string; limit?: number } = {},
    ): Promise<Page<AdminUser>> {
      const res = await apiClient.get<ApiEnvelope<Page<AdminUser>>>('/admin/users', {
        params,
      });
      return unwrap(res);
    },
    async setUserStatus(
      id: string,
      status: 'ACTIVE' | 'SUSPENDED',
      reason?: string,
    ): Promise<{ id: string; email: string; status: UserStatus }> {
      const res = await apiClient.patch<
        ApiEnvelope<{ id: string; email: string; status: UserStatus }>
      >(`/admin/users/${id}/status`, { status, ...(reason ? { reason } : {}) });
      return unwrap(res);
    },
    async invoices(
      params: { status?: string; cursor?: string; limit?: number } = {},
    ): Promise<Page<AdminInvoice>> {
      const res = await apiClient.get<ApiEnvelope<Page<AdminInvoice>>>(
        '/admin/invoices',
        { params },
      );
      return unwrap(res);
    },
    async tiers(): Promise<Tier[]> {
      const res = await apiClient.get<ApiEnvelope<Tier[]>>('/admin/tiers');
      return unwrap(res);
    },
    async updateTier(id: string, patch: TierPatch): Promise<Tier> {
      const res = await apiClient.patch<ApiEnvelope<Tier>>(`/admin/tiers/${id}`, patch);
      return unwrap(res);
    },
    async tenantRouters(
      tenantId: string,
      params: { cursor?: string; limit?: number } = {},
    ): Promise<Page<AdminTenantRouter>> {
      const res = await apiClient.get<ApiEnvelope<Page<AdminTenantRouter>>>(
        `/admin/tenants/${tenantId}/routers`,
        { params },
      );
      return unwrap(res);
    },
    async validateInvoice(
      invoiceId: string,
      periodDays?: number,
    ): Promise<void> {
      await apiClient.post(`/admin/invoices/${invoiceId}/validate`, {
        ...(periodDays ? { periodDays } : {}),
      });
    },
    async rejectInvoice(
      invoiceId: string,
      reason?: string,
    ): Promise<void> {
      await apiClient.post(`/admin/invoices/${invoiceId}/reject`, {
        ...(reason ? { reason } : {}),
      });
    },
    async invoiceProofs(invoiceId: string): Promise<PaymentProof[]> {
      const res = await apiClient.get<ApiEnvelope<PaymentProof[]>>(
        `/admin/invoices/${invoiceId}/proofs`,
      );
      return unwrap(res);
    },
    async listTickets(
      params: { status?: string; cursor?: string; limit?: number } = {},
    ): Promise<Page<AdminTicketSummary>> {
      const res = await apiClient.get<ApiEnvelope<Page<AdminTicketSummary>>>(
        '/admin/tickets',
        { params },
      );
      return unwrap(res);
    },
    async getTicket(id: string): Promise<SupportTicketDetail> {
      const res = await apiClient.get<ApiEnvelope<SupportTicketDetail>>(
        `/admin/tickets/${id}`,
      );
      return unwrap(res);
    },
    async replyToTicket(ticketId: string, body: string): Promise<TicketMessage> {
      const res = await apiClient.post<ApiEnvelope<TicketMessage>>(
        `/admin/tickets/${ticketId}/messages`,
        { body },
      );
      return unwrap(res);
    },
    async setTicketStatus(
      ticketId: string,
      status: 'OPEN' | 'IN_PROGRESS' | 'RESOLVED' | 'CLOSED',
    ): Promise<void> {
      await apiClient.patch(`/admin/tickets/${ticketId}/status`, { status });
    },
    async getConfig(): Promise<Record<string, string>> {
      const res = await apiClient.get<ApiEnvelope<Record<string, string>>>(
        '/admin/config',
      );
      return unwrap(res);
    },
    async updateConfig(entries: Record<string, string>): Promise<void> {
      await apiClient.patch('/admin/config', entries);
    },
    async audit(
      params: { tenantId?: string; cursor?: string; limit?: number } = {},
    ): Promise<Page<AuditEntry>> {
      const res = await apiClient.get<ApiEnvelope<Page<AuditEntry>>>('/admin/audit', {
        params,
      });
      return unwrap(res);
    },
  },
  support: {
    async createTicket(subject: string, body: string): Promise<SupportTicket> {
      const res = await apiClient.post<ApiEnvelope<SupportTicket>>(
        '/support/tickets',
        { subject, body },
      );
      return unwrap(res);
    },
    async listTickets(cursor?: string, limit = 20): Promise<Page<SupportTicketSummary>> {
      const res = await apiClient.get<ApiEnvelope<Page<SupportTicketSummary>>>(
        '/support/tickets',
        { params: { ...(cursor ? { cursor } : {}), limit } },
      );
      return unwrap(res);
    },
    async getTicket(id: string): Promise<SupportTicketDetail> {
      const res = await apiClient.get<ApiEnvelope<SupportTicketDetail>>(
        `/support/tickets/${id}`,
      );
      return unwrap(res);
    },
    async addMessage(ticketId: string, body: string): Promise<TicketMessage> {
      const res = await apiClient.post<ApiEnvelope<TicketMessage>>(
        `/support/tickets/${ticketId}/messages`,
        { body },
      );
      return unwrap(res);
    },
  },

  accounting: {
    async revenueByPeriod(months = 12): Promise<RevenueByPeriodItem[]> {
      const res = await apiClient.get<ApiEnvelope<RevenueByPeriodItem[]>>(
        '/accounting/revenue/by-period',
        { params: { months } },
      );
      return unwrap(res);
    },
    async revenueByRouter(from?: string, to?: string): Promise<RevenueByRouterItem[]> {
      const res = await apiClient.get<ApiEnvelope<RevenueByRouterItem[]>>(
        '/accounting/revenue/by-router',
        { params: { from, to } },
      );
      return unwrap(res);
    },
    async invoices(
      page = 1,
      limit = 20,
    ): Promise<{ items: InvoiceItem[]; total: number; page: number; limit: number }> {
      const res = await apiClient.get<
        ApiEnvelope<{ items: InvoiceItem[]; total: number; page: number; limit: number }>
      >('/accounting/invoices', { params: { page, limit } });
      return unwrap(res);
    },
    async generateInvoice(periodStart: string, periodEnd: string): Promise<InvoiceItem> {
      const res = await apiClient.post<ApiEnvelope<InvoiceItem>>(
        '/accounting/invoices/generate',
        { periodStart, periodEnd },
      );
      return unwrap(res);
    },
  },
  analytics: {
    async overview(filters: AnalyticsFilters): Promise<AnalyticsOverview> {
      const res = await apiClient.get<ApiEnvelope<AnalyticsOverview>>('/analytics/overview', {
        params: filters,
      });
      return unwrap(res);
    },
    async routers(filters: Omit<AnalyticsFilters, 'routerId' | 'planId'>): Promise<AnalyticsRouterSummary[]> {
      const res = await apiClient.get<ApiEnvelope<AnalyticsRouterSummary[]>>('/analytics/routers', {
        params: filters,
      });
      return unwrap(res);
    },
    async routerDetail(
      routerId: string,
      filters: Omit<AnalyticsFilters, 'routerId' | 'planId'>,
    ): Promise<AnalyticsRouterDetail> {
      const res = await apiClient.get<ApiEnvelope<AnalyticsRouterDetail>>(
        `/analytics/routers/${routerId}`,
        { params: filters },
      );
      return unwrap(res);
    },
    async plans(filters: Omit<AnalyticsFilters, 'planId'>): Promise<AnalyticsPlanPerformance[]> {
      const res = await apiClient.get<ApiEnvelope<AnalyticsPlanPerformance[]>>('/analytics/plans', {
        params: filters,
      });
      return unwrap(res);
    },
    async traffic(filters: Omit<AnalyticsFilters, 'planId'>): Promise<AnalyticsTraffic> {
      const res = await apiClient.get<ApiEnvelope<AnalyticsTraffic>>('/analytics/traffic', {
        params: filters,
      });
      return unwrap(res);
    },
    async forecast(params: { horizonDays?: number; routerId?: string; planId?: string }): Promise<ForecastOverview> {
      const res = await apiClient.get<ApiEnvelope<ForecastOverview>>('/analytics/forecast', { params });
      return unwrap(res);
    },
    async forecastTraffic(routerId?: string): Promise<ForecastTraffic> {
      const res = await apiClient.get<ApiEnvelope<ForecastTraffic>>('/analytics/forecast/traffic', {
        params: { routerId },
      });
      return unwrap(res);
    },
    async forecastRouters(): Promise<RouterForecastItem[]> {
      const res = await apiClient.get<ApiEnvelope<RouterForecastItem[]>>('/analytics/forecast/routers');
      return unwrap(res);
    },
    async forecastPlans(): Promise<PlanForecastItem[]> {
      const res = await apiClient.get<ApiEnvelope<PlanForecastItem[]>>('/analytics/forecast/plans');
      return unwrap(res);
    },
    async insights(): Promise<BusinessInsight[]> {
      const res = await apiClient.get<ApiEnvelope<BusinessInsight[]>>('/analytics/insights');
      return unwrap(res);
    },
  },
  vouchers: {
    async verify(
      ticket: string,
      password?: string,
      routerId?: string,
    ): Promise<VoucherVerificationResult> {
      const res = await apiClient.post<ApiEnvelope<VoucherVerificationResult>>(
        '/vouchers/verify',
        { ticket, password, routerId },
      );
      return unwrap(res);
    },
  },
};

// ── Types du back-office ──────────────────────────────────

export type BillingPeriod = 'MONTHLY' | 'ANNUAL';
export type TenantStatus = 'ACTIVE' | 'SUSPENDED' | 'DELETED';
export type UserStatus = 'ACTIVE' | 'SUSPENDED' | 'DELETED';

export type Page<T> = { items: T[]; nextCursor: string | null };

export type TierFeature = { label: string; included: boolean };

export type Tier = {
  id: string;
  key: string;
  name: string;
  monthlyXof: number;
  /** Mensualité effective si le client règle l'année. */
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

export type TierPatch = Partial<
  Pick<
    Tier,
    | 'name'
    | 'monthlyXof'
    | 'annualDiscount'
    | 'routerLimit'
    | 'badge'
    | 'tagline'
    | 'displayOrder'
    | 'active'
  >
>;

export type UpgradeRequestResult = {
  invoice: {
    id: string;
    amount: number;
    currency: string;
    status: string;
    tierKey: string;
    tierName: string;
    billingPeriod: BillingPeriod;
  };
  instructions: string;
};

export type PlatformMetrics = {
  tenants: {
    total: number;
    pro: number;
    trialing: number;
    suspended: number;
    locked: number;
  };
  revenue: { mrrXof: number; currency: string; untieredActive: number };
  trialsExpiringIn7Days: number;
  pendingInvoices: number;
  routers: { total: number; online: number };
  vouchers30d: { generated: number; activated: number };
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
  // Count seulement — jamais la liste nominative (isolation : SUPER_ADMIN
  // voit "combien de routeurs", jamais "lesquels").
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
  /** Résumé laissé par le conseiller d'abonnement côté client. */
  note: string | null;
  tierKey: string | null;
  tierName: string | null;
  createdAt: string;
  paidAt: string | null;
};

export type AuditEntry = {
  id: string;
  tenantId: string;
  tenantName: string;
  userId: string | null;
  action: string;
  entityType: string;
  entityId: string | null;
  metadata: unknown;
  ip: string | null;
  createdAt: string;
};

export type PaymentInfo = {
  wave: string | null;
  orangeMoney: string | null;
  instructions: string | null;
};

export type PaymentProof = {
  id: string;
  invoiceId: string;
  method: 'WAVE' | 'ORANGE_MONEY';
  imageUrl: string;
  note: string | null;
  createdAt: string;
};

export type SupportTicketSummary = {
  id: string;
  subject: string;
  status: string;
  priority: string;
  createdAt: string;
  updatedAt: string;
  _count: { messages: number };
};

export type SupportTicket = {
  id: string;
  subject: string;
  status: string;
  priority: string;
  createdAt: string;
  messages: TicketMessage[];
};

export type SupportTicketDetail = {
  id: string;
  subject: string;
  status: string;
  priority: string;
  createdAt: string;
  messages: TicketMessage[];
};

export type TicketMessage = {
  id: string;
  body: string;
  imageUrl: string | null;
  isAdmin: boolean;
  createdAt: string;
  user: { id: string; name: string | null };
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

export type AdminTicketSummary = {
  id: string;
  subject: string;
  status: string;
  priority: string;
  createdAt: string;
  updatedAt: string;
  tenantName: string;
  userName: string | null;
  _count: { messages: number };
};

export type TenantSubscription = {
  plan: SubscriptionPlan;
  status: string;
  currentPeriodStart: string | null;
  currentPeriodEnd: string | null;
  updatedAt: string;
};

/**
 * Conservé pour les appelants existants. La logique vit dans
 * `src/lib/errors.ts` : ce fichier ne fait plus que déléguer, pour que tous
 * les écrans profitent de la même traduction sans être réécrits un par un.
 * Préférer `describeError()` quand on a besoin du retry ou des erreurs de champ.
 */
export function extractErrorMessage(error: unknown): string {
  return errorMessage(error);
}
