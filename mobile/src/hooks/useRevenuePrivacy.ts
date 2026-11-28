import { useCallback, useEffect, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as LocalAuthentication from 'expo-local-authentication';
import { reportSilent } from '@/src/lib/report';

const STORAGE_KEY = 'revenue.hidden';

/**
 * Masquage du revenu du jour. Une fois masqué, le dévoiler exige empreinte /
 * Face ID (ou code de l'appareil en repli). Le masquer ne demande rien.
 *
 * `hidden` reste à `true` tant que la préférence n'est pas chargée : on ne
 * veut jamais laisser clignoter le montant avant de savoir si l'utilisateur
 * l'avait masqué.
 */
export function useRevenuePrivacy() {
  const [hidden, setHidden] = useState(true);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let active = true;
    AsyncStorage.getItem(STORAGE_KEY)
      .then((v) => {
        if (active) setHidden(v === 'true');
      })
      .catch((e) => {
        reportSilent('revenue-privacy.load', e);
        if (active) setHidden(false);
      })
      .finally(() => {
        if (active) setReady(true);
      });
    return () => {
      active = false;
    };
  }, []);

  const persist = useCallback((value: boolean) => {
    AsyncStorage.setItem(STORAGE_KEY, value ? 'true' : 'false').catch((e) =>
      reportSilent('revenue-privacy.persist', e),
    );
  }, []);

  const hide = useCallback(() => {
    setHidden(true);
    persist(true);
  }, [persist]);

  const reveal = useCallback(
    async (promptMessage: string): Promise<boolean> => {
      try {
        const [hasHardware, enrolled] = await Promise.all([
          LocalAuthentication.hasHardwareAsync(),
          LocalAuthentication.isEnrolledAsync(),
        ]);
        // Appareil sans biométrie ni code configuré : exiger une auth
        // rendrait le revenu définitivement inaccessible. On dévoile alors
        // directement plutôt que de piéger l'utilisateur.
        if (hasHardware && enrolled) {
          const res = await LocalAuthentication.authenticateAsync({
            promptMessage,
            disableDeviceFallback: false,
          });
          if (!res.success) return false;
        }
      } catch (e) {
        reportSilent('revenue-privacy.authenticate', e);
        return false;
      }
      setHidden(false);
      persist(false);
      return true;
    },
    [persist],
  );

  return { hidden, ready, hide, reveal };
}
