import { useEffect, useRef, useState, type PropsWithChildren } from 'react';
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

const INACTIVITY_TIMEOUT_MS = 2 * 60 * 1000;

export function AppLockProvider({ children }: PropsWithChildren) {
  const { isAuthenticated } = useAuth();
  const [locked, setLocked] = useState(false);
  const [supported, setSupported] = useState(false);
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
        if (
          isAuthenticated &&
          supported &&
          since !== null &&
          Date.now() - since > INACTIVITY_TIMEOUT_MS
        ) {
          setLocked(true);
        }
      }
    });
    return () => sub.remove();
  }, [isAuthenticated, supported]);

  useEffect(() => {
    if (!isAuthenticated) setLocked(false);
  }, [isAuthenticated]);

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
    <>
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
    </>
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
