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
  };
  tenant: { id: string; name: string; slug: string; status: string };
  subscription: {
    plan: SubscriptionPlan;
    status: string;
    currentPeriodEnd: string | null;
  } | null;
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
  createdAt: string;
  updatedAt: string;
};

export type RouterCredentials = { username: string; password: string };

export type ProvisionBundle = {
  routerId: string;
  wgIp: string;
  allocatedPort: number;
  serverPublicKey: string;
  endpoint: string;
  peerPublicKey: string;
  routerPrivateKey: string;
};

export type RemoteStatus = {
  status: 'ACTIVE' | 'REVOKED' | 'PENDING' | 'ERROR' | 'NONE';
  wgIp?: string;
  allocatedPort?: number;
  endpoint?: string;
  provisionedAt?: string | null;
  revokedAt?: string | null;
};

export type PlanStatus = 'ACTIVE' | 'ARCHIVED';
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
  status: PlanStatus;
  displayOrder: number;
};
export type PlanExpiration = 'ELAPSED' | 'RADIO_PAUSE';

export type MetricsPeriod = 'today' | '7d' | '30d';
export type PlanBreakdown = {
  planId: string;
  planName: string;
  priceXof: number;
  sold: number;
  revenueXof: number;
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
};

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
};

const DEFAULT_API_BASE_URL =
  process.env.EXPO_PUBLIC_API_BASE_URL?.trim() || 'http://10.0.2.2:3001/api';

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
    : looksLikeIpOrLocalhost(raw)
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
  if (storedBaseUrl) apiBaseUrl = normalizeApiBaseUrl(storedBaseUrl);
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
    async provisionRemote(id: string): Promise<ProvisionBundle> {
      const res = await apiClient.post<ApiEnvelope<ProvisionBundle>>(
        `/routers/${id}/remote/provision`,
      );
      return unwrap(res);
    },
    async revokeRemote(id: string): Promise<{ revoked: boolean }> {
      const res = await apiClient.post<ApiEnvelope<{ revoked: boolean }>>(
        `/routers/${id}/remote/revoke`,
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
    async listBatches(id: string): Promise<VoucherBatch[]> {
      const res = await apiClient.get<ApiEnvelope<VoucherBatch[]>>(
        `/routers/${id}/vouchers/batches`,
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
    async requestUpgrade(note?: string): Promise<{
      invoice: { id: string; amount: number; currency: string; status: string };
      instructions: string;
    }> {
      const res = await apiClient.post<
        ApiEnvelope<{
          invoice: {
            id: string;
            amount: number;
            currency: string;
            status: string;
          };
          instructions: string;
        }>
      >('/subscriptions/request-upgrade', note ? { note } : {});
      return unwrap(res);
    },
  },
};

export function extractErrorMessage(error: unknown): string {
  if (axios.isAxiosError(error)) {
    // Prefer the backend's explicit message (e.g. "Invalid credentials").
    const body = error.response?.data as { message?: string } | undefined;
    if (body?.message) return body.message;
    if (error.response?.status === 401) {
      return 'Session expirée. Merci de vous reconnecter.';
    }
    if (error.code === 'ERR_NETWORK') {
      return 'Serveur injoignable. Vérifiez l’URL du serveur et votre connexion.';
    }
    if (error.message) return error.message;
  }
  if (error instanceof Error) return error.message;
  return 'Une erreur est survenue.';
}
