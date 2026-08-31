import { useRouter } from 'expo-router';
import {
  createContext,
  PropsWithChildren,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import Constants from 'expo-constants';
import * as Crypto from 'expo-crypto';
import * as Google from 'expo-auth-session/providers/google';
import * as WebBrowser from 'expo-web-browser';
import {
  api,
  bootstrapApiState,
  clearAuthTokens,
  extractErrorMessage,
  getApiBaseUrl,
  getAuthTokens,
  setApiBaseUrl,
  setApiEventHandlers,
  setAuthTokens,
  type Entitlement,
  type Me,
} from '@/src/lib/api';
import { deleteLocalCredentials } from '@/src/lib/router-credentials';

WebBrowser.maybeCompleteAuthSession();

const GOOGLE_WEB_CLIENT_ID = Constants.expoConfig?.extra?.googleWebClientId as string | undefined;
const GOOGLE_ANDROID_CLIENT_ID = Constants.expoConfig?.extra?.googleAndroidClientId as string | undefined;

async function clearAllLocalRouterCredentials(): Promise<void> {
  try {
    const routers = await api.routers.list();
    await Promise.all(
      routers.map((router) => deleteLocalCredentials(router.id)),
    );
  } catch {
    // best-effort — logout must not be blocked by this cleanup
  }
}

type AuthContextValue = {
  isReady: boolean;
  isAuthenticated: boolean;
  isBusy: boolean;
  me: Me | null;
  isPro: boolean;
  /** Décidé par le serveur ; l'app ne fait que le refléter. */
  entitlement: Entitlement;
  /** L'essai est terminé et aucun forfait n'est actif. */
  isLocked: boolean;
  apiBaseUrl: string;
  error: string | null;
  clearError: () => void;
  signup: (
    tenantName: string,
    email: string,
    password: string,
  ) => Promise<void>;
  login: (email: string, password: string) => Promise<void>;
  googleLogin: (idToken: string, nonce?: string) => Promise<void>;
  googleAuthAvailable: boolean;
  promptGoogleLogin: () => void;
  appleLogin: (
    identityToken: string,
    nonce?: string,
    fullName?: string,
  ) => Promise<void>;
  logout: () => Promise<void>;
  refreshProfile: () => Promise<void>;
  updateApiBaseUrl: (value: string) => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: PropsWithChildren) {
  const router = useRouter();
  const [isReady, setIsReady] = useState(false);
  const [isBusy, setIsBusy] = useState(false);
  const [me, setMe] = useState<Me | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [apiBaseUrl, setApiBaseUrlState] = useState(getApiBaseUrl());

  const nonceRef = useRef(Crypto.randomUUID());
  const [nonceHash, setNonceHash] = useState<string | null>(null);

  useEffect(() => {
    Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, nonceRef.current).then(
      setNonceHash,
    );
  }, []);

  const [, googleResponse, promptGoogle] = Google.useIdTokenAuthRequest({
    clientId: GOOGLE_WEB_CLIENT_ID,
    androidClientId: GOOGLE_ANDROID_CLIENT_ID,
    extraParams: nonceHash ? { nonce: nonceHash } : undefined,
  });

  useEffect(() => {
    if (googleResponse?.type === 'success') {
      const idToken = googleResponse.params.id_token;
      if (idToken) {
        googleLogin(idToken, nonceRef.current).catch(() => {});
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [googleResponse]);

  useEffect(() => {
    let mounted = true;
    async function boot() {
      try {
        await bootstrapApiState();
        if (!mounted) return;
        setApiBaseUrlState(getApiBaseUrl());
        setApiEventHandlers({
          onUnauthorized: () => {
            setMe(null);
            router.replace('/login');
          },
          onTokensChanged: () => setApiBaseUrlState(getApiBaseUrl()),
        });

        if (!getAuthTokens()) {
          setMe(null);
          return;
        }
        setMe(await api.auth.me());
      } catch {
        await clearAuthTokens();
        if (mounted) setMe(null);
      } finally {
        if (mounted) setIsReady(true);
      }
    }
    void boot();
    return () => {
      mounted = false;
    };
  }, [router]);

  async function afterAuth(): Promise<void> {
    setMe(await api.auth.me());
    router.replace('/(tabs)');
  }

  async function signup(
    tenantName: string,
    email: string,
    password: string,
  ): Promise<void> {
    setIsBusy(true);
    setError(null);
    try {
      await setAuthTokens(await api.auth.signup(tenantName, email, password));
      await afterAuth();
    } catch (e) {
      setError(extractErrorMessage(e));
      throw e;
    } finally {
      setIsBusy(false);
    }
  }

  async function login(email: string, password: string): Promise<void> {
    setIsBusy(true);
    setError(null);
    try {
      await setAuthTokens(await api.auth.login(email, password));
      await afterAuth();
    } catch (e) {
      setError(extractErrorMessage(e));
      throw e;
    } finally {
      setIsBusy(false);
    }
  }

  async function googleLogin(idToken: string, nonce?: string): Promise<void> {
    setIsBusy(true);
    setError(null);
    try {
      await setAuthTokens(await api.auth.googleLogin(idToken, nonce));
      await afterAuth();
    } catch (e) {
      setError(extractErrorMessage(e));
      throw e;
    } finally {
      setIsBusy(false);
    }
  }

  async function appleLogin(
    identityToken: string,
    nonce?: string,
    fullName?: string,
  ): Promise<void> {
    setIsBusy(true);
    setError(null);
    try {
      await setAuthTokens(await api.auth.appleLogin(identityToken, nonce, fullName));
      await afterAuth();
    } catch (e) {
      setError(extractErrorMessage(e));
      throw e;
    } finally {
      setIsBusy(false);
    }
  }

  async function logout(): Promise<void> {
    setIsBusy(true);
    try {
      await clearAllLocalRouterCredentials();
      await api.auth.logout();
    } catch {
      // best-effort
    } finally {
      await clearAuthTokens();
      setMe(null);
      setIsBusy(false);
      router.replace('/login');
    }
  }

  async function refreshProfile(): Promise<void> {
    setMe(await api.auth.me());
  }

  async function updateApiBaseUrl(value: string): Promise<void> {
    setApiBaseUrlState(await setApiBaseUrl(value));
  }

  // Tant que /auth/me n'a pas répondu on ne verrouille rien : un faux cadenas
  // au démarrage serait pire qu'un écran vide.
  const entitlement: Entitlement = me?.entitlement ?? {
    tier: 'TRIAL',
    localAllowed: true,
    remoteAllowed: false,
    endsAt: null,
    daysLeft: 0,
    tierKey: null,
    routerLimit: null,
  };

  const contextValue = useMemo<AuthContextValue>(
    () => ({
      isReady,
      isAuthenticated: Boolean(me),
      isBusy,
      me,
      isPro: entitlement.tier === 'PRO',
      entitlement,
      isLocked: entitlement.tier === 'LOCKED',
      apiBaseUrl,
      error,
      clearError: () => setError(null),
      signup,
      login,
      googleLogin,
      googleAuthAvailable: Boolean(GOOGLE_WEB_CLIENT_ID),
      promptGoogleLogin: () => {
        promptGoogle().catch(() => {});
      },
      appleLogin,
      logout,
      refreshProfile,
      updateApiBaseUrl,
    }),
    [apiBaseUrl, entitlement, error, isBusy, isReady, me, promptGoogle],
  );

  return (
    <AuthContext.Provider value={contextValue}>{children}</AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const value = useContext(AuthContext);
  if (!value) throw new Error('useAuth must be used inside AuthProvider');
  return value;
}
