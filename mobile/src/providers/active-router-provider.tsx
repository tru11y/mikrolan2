import {
  createContext,
  PropsWithChildren,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';
import {
  deleteStoredValue,
  getStoredValue,
  setStoredValue,
} from '@/src/lib/storage';

const KEY = 'mikrolan_active_router_id';

// The selected router drives which bottom nav (and which Maison content) is
// shown app-wide: global (Maison/Routeurs/Compte) vs router-connected
// (Maison=dashboard/Plans/Tickets/Rapport), mirroring the MikroTicket reference.
type ActiveRouterContextValue = {
  isReady: boolean;
  activeRouterId: string | null;
  selectRouter: (id: string) => Promise<void>;
  clearActiveRouter: () => Promise<void>;
};

const ActiveRouterContext = createContext<ActiveRouterContextValue | null>(
  null,
);

export function ActiveRouterProvider({ children }: PropsWithChildren) {
  const [isReady, setIsReady] = useState(false);
  const [activeRouterId, setActiveRouterId] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;
    (async () => {
      const stored = await getStoredValue(KEY);
      if (mounted) setActiveRouterId(stored);
      if (mounted) setIsReady(true);
    })();
    return () => {
      mounted = false;
    };
  }, []);

  // Stable identities: router/[id].tsx's activation effect depends on
  // `selectRouter`, so a fresh closure on every activeRouterId change would
  // re-trigger that effect and immediately re-select the router right after
  // clearActiveRouter() runs — a self-reactivation loop that made "Quitter"
  // a no-op. useCallback with empty deps (functional setState only) fixes it.
  const selectRouter = useCallback(async (id: string): Promise<void> => {
    setActiveRouterId(id);
    await setStoredValue(KEY, id);
  }, []);

  const clearActiveRouter = useCallback(async (): Promise<void> => {
    setActiveRouterId(null);
    await deleteStoredValue(KEY);
  }, []);

  const value = useMemo<ActiveRouterContextValue>(
    () => ({ isReady, activeRouterId, selectRouter, clearActiveRouter }),
    [isReady, activeRouterId, selectRouter, clearActiveRouter],
  );

  return (
    <ActiveRouterContext.Provider value={value}>
      {children}
    </ActiveRouterContext.Provider>
  );
}

export function useActiveRouter(): ActiveRouterContextValue {
  const value = useContext(ActiveRouterContext);
  if (!value) {
    throw new Error('useActiveRouter must be used inside ActiveRouterProvider');
  }
  return value;
}
