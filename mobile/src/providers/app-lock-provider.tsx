import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  type PropsWithChildren,
} from 'react';
import {
  AppState,
  type AppStateStatus,
  Modal,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import * as LocalAuthentication from 'expo-local-authentication';
import { Ionicons } from '@expo/vector-icons';
import { Button, theme } from '@/src/components/ui';
import { useAuth } from '@/src/providers/auth-provider';
import { getStoredValue, setStoredValue } from '@/src/lib/storage';

const INACTIVITY_TIMEOUT_MS = 2 * 60 * 1000;
const PREF_KEY = (userId: string) => `mikrolan_applock_enabled_${userId}`;

type AppLockContextValue = {
  /** L'appareil a une biométrie/un code enrollé — sinon le toggle n'a pas de sens. */
  supported: boolean;
  /** Préférence de CET utilisateur sur CET appareil (stockée localement). */
  enabled: boolean;
  setEnabled: (value: boolean) => Promise<void>;
};

const AppLockContext = createContext<AppLockContextValue | null>(null);

export function useAppLock(): AppLockContextValue {
  const value = useContext(AppLockContext);
  if (!value) throw new Error('useAppLock must be used inside AppLockProvider');
  return value;
}

export function AppLockProvider({ children }: PropsWithChildren) {
  const { isAuthenticated, me } = useAuth();
  const userId = me?.user.id ?? null;

  const [locked, setLocked] = useState(false);
  const [supported, setSupported] = useState(false);
  const [enabled, setEnabledState] = useState(true);
  const backgroundedAt = useRef<number | null>(null);
  const appState = useRef<AppStateStatus>(AppState.currentState);

  useEffect(() => {
    let mounted = true;
    (async () => {
      const hasHardware = await LocalAuthentication.hasHardwareAsync();
      const isEnrolled = await LocalAuthentication.isEnrolledAsync();
      if (mounted) setSupported(hasHardware && isEnrolled);
    })();
    return () => {
      mounted = false;
    };
  }, []);

  // Préférence par compte : chaque utilisateur qui se connecte sur cet
  // appareil garde son propre choix (par défaut activé si dispo).
  useEffect(() => {
    if (!userId) return;
    let mounted = true;
    (async () => {
      const stored = await getStoredValue(PREF_KEY(userId));
      if (mounted) setEnabledState(stored !== 'false');
    })();
    return () => {
      mounted = false;
    };
  }, [userId]);

  async function setEnabled(value: boolean): Promise<void> {
    setEnabledState(value);
    if (userId) await setStoredValue(PREF_KEY(userId), value ? 'true' : 'false');
  }

  const active = isAuthenticated && supported && enabled;

  useEffect(() => {
    const sub = AppState.addEventListener('change', (next) => {
      const prev = appState.current;
      appState.current = next;

      if (prev === 'active' && next !== 'active') {
        backgroundedAt.current = Date.now();
        return;
      }

      if (next === 'active' && prev !== 'active') {
        const since = backgroundedAt.current;
        backgroundedAt.current = null;
        if (active && since !== null && Date.now() - since > INACTIVITY_TIMEOUT_MS) {
          setLocked(true);
        }
      }
    });
    return () => sub.remove();
  }, [active]);

  useEffect(() => {
    if (!active) setLocked(false);
  }, [active]);

  async function unlock(): Promise<void> {
    const result = await LocalAuthentication.authenticateAsync({
      promptMessage: 'Déverrouiller MikroLan2',
      cancelLabel: 'Annuler',
      disableDeviceFallback: false,
    });
    if (result.success) setLocked(false);
  }

  useEffect(() => {
    if (locked) void unlock();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [locked]);

  return (
    <AppLockContext.Provider value={{ supported, enabled, setEnabled }}>
      {children}
      <Modal visible={locked} animationType="fade" statusBarTranslucent>
        <View style={styles.container}>
          <Ionicons name="lock-closed" size={40} color={theme.primary} />
          <Text style={styles.title}>MikroLan2 verrouillé</Text>
          <Text style={styles.subtitle}>
            Authentifiez-vous pour continuer
          </Text>
          <Button title="Déverrouiller" onPress={() => void unlock()} />
        </View>
      </Modal>
    </AppLockContext.Provider>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: theme.bg,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
    padding: 24,
  },
  title: { color: theme.text, fontSize: 18, fontWeight: '700' },
  subtitle: { color: theme.textMuted, fontSize: 14, textAlign: 'center' },
});
