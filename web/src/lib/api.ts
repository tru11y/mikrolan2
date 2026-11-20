import axios, {
  type AxiosError,
  type AxiosInstance,
  type InternalAxiosRequestConfig,
} from 'axios';

export type ApiEnvelope<T> = { success: boolean; data: T; error?: unknown };
export type AuthTokens = { accessToken: string; refreshToken: string; expiresIn?: number };

const ACCESS_KEY = 'mikrolan_access_token';
const REFRESH_KEY = 'mikrolan_refresh_token';

export const API_BASE_URL = (
  process.env.NEXT_PUBLIC_API_BASE_URL?.trim() || 'http://localhost:3000/api'
).replace(/\/+$/, '');

// ── Token store (localStorage, per-viewer) ──────────────────────────────────
function read(key: string): string | null {
  try {
    return typeof window === 'undefined' ? null : window.localStorage.getItem(key);
  } catch {
    return null;
  }
}
function write(key: string, value: string | null): void {
  try {
    if (typeof window === 'undefined') return;
    if (value === null) window.localStorage.removeItem(key);
    else window.localStorage.setItem(key, value);
  } catch {
    /* ignore */
  }
}

export function getTokens(): AuthTokens | null {
  const accessToken = read(ACCESS_KEY);
  const refreshToken = read(REFRESH_KEY);
  if (!accessToken || !refreshToken) return null;
  return { accessToken, refreshToken };
}
export function setTokens(tokens: AuthTokens): void {
  write(ACCESS_KEY, tokens.accessToken);
  write(REFRESH_KEY, tokens.refreshToken);
}
export function clearTokens(): void {
  write(ACCESS_KEY, null);
  write(REFRESH_KEY, null);
}

let onUnauthorized: (() => void) | null = null;
export function setUnauthorizedHandler(fn: (() => void) | null): void {
  onUnauthorized = fn;
}

// ── Axios instance ──────────────────────────────────────────────────────────
export const api: AxiosInstance = axios.create({
  baseURL: API_BASE_URL,
  timeout: 20_000,
});

api.interceptors.request.use((config: InternalAxiosRequestConfig) => {
  const token = read(ACCESS_KEY);
  if (token) config.headers.set('Authorization', `Bearer ${token}`);
  return config;
});

let refreshInFlight: Promise<AuthTokens | null> | null = null;
async function refresh(): Promise<AuthTokens | null> {
  const refreshToken = read(REFRESH_KEY);
  if (!refreshToken) return null;
  if (!refreshInFlight) {
    refreshInFlight = axios
      .post<ApiEnvelope<AuthTokens>>(`${API_BASE_URL}/auth/refresh`, { refreshToken })
      .then((res) => {
        const next = res.data.data;
        setTokens(next);
        return next;
      })
      .catch(() => null)
      .finally(() => {
        refreshInFlight = null;
      });
  }
  return refreshInFlight;
}

api.interceptors.response.use(
  (res) => res,
  async (error: AxiosError) => {
    const original = error.config as (InternalAxiosRequestConfig & { _retried?: boolean }) | undefined;
    const status = error.response?.status;
    if (status === 401 && original && !original._retried) {
      original._retried = true;
      const next = await refresh();
      if (next) {
        original.headers.set('Authorization', `Bearer ${next.accessToken}`);
        return api.request(original);
      }
      clearTokens();
      onUnauthorized?.();
    }
    return Promise.reject(error);
  },
);

// ── Typed helpers ───────────────────────────────────────────────────────────
export async function apiGet<T>(url: string, params?: Record<string, unknown>): Promise<T> {
  const res = await api.get<ApiEnvelope<T>>(url, { params });
  return res.data.data;
}
export async function apiPost<T>(url: string, body?: unknown): Promise<T> {
  const res = await api.post<ApiEnvelope<T>>(url, body);
  return res.data.data;
}
export async function apiPatch<T>(url: string, body?: unknown): Promise<T> {
  const res = await api.patch<ApiEnvelope<T>>(url, body);
  return res.data.data;
}
export async function apiDelete<T>(url: string, body?: unknown): Promise<T> {
  const res = await api.delete<ApiEnvelope<T>>(url, { data: body });
  return res.data.data;
}

export function extractErrorMessage(error: unknown): string {
  if (axios.isAxiosError(error)) {
    const data = error.response?.data as { error?: { message?: string }; message?: string } | undefined;
    return data?.error?.message || data?.message || error.message || 'Erreur réseau';
  }
  return error instanceof Error ? error.message : 'Erreur inconnue';
}
