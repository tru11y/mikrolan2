'use client';

import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import {
  apiGet,
  apiPost,
  clearTokens,
  getTokens,
  setTokens,
  setUnauthorizedHandler,
} from './api';
import type { AuthTokens } from './api';
import type { Me, MeResponse } from './types';

type AuthState = {
  me: Me | null;
  loading: boolean;
  login: (email: string, password: string, totpCode?: string) => Promise<void>;
  logout: () => Promise<void>;
  refreshMe: () => Promise<void>;
};

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const router = useRouter();
  const [me, setMe] = useState<Me | null>(null);
  const [loading, setLoading] = useState(true);

  async function refreshMe(): Promise<void> {
    try {
      const res = await apiGet<MeResponse>('/auth/me');
      const flat: Me = {
        id: res.user.id,
        email: res.user.email,
        role: res.user.role,
        name: res.user.name ?? null,
        tenantId: res.tenant.id,
        status: res.user.status,
        hasPassword: res.user.hasPassword,
        googleId: res.user.googleId ?? null,
        notificationsEnabled: res.user.notificationsEnabled,
      };
      setMe(flat);
    } catch {
      setMe(null);
    }
  }

  useEffect(() => {
    setUnauthorizedHandler(() => {
      setMe(null);
      router.replace('/login');
    });
    (async () => {
      if (getTokens()) await refreshMe();
      setLoading(false);
    })();
    return () => setUnauthorizedHandler(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function login(email: string, password: string, totpCode?: string): Promise<void> {
    const tokens = await apiPost<AuthTokens>('/auth/login', { email, password, totpCode });
    setTokens(tokens);
    await refreshMe();
  }

  async function logout(): Promise<void> {
    try {
      await apiPost('/auth/logout', {});
    } catch {
      /* ignore */
    }
    clearTokens();
    setMe(null);
    router.replace('/login');
  }

  return (
    <AuthContext.Provider value={{ me, loading, login, logout, refreshMe }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
