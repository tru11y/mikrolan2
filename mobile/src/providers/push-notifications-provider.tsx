import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  PropsWithChildren,
} from 'react';
import { Platform } from 'react-native';
import * as Notifications from 'expo-notifications';
import * as Device from 'expo-device';
import Constants from 'expo-constants';
import { api } from '@/src/lib/api';
import { useAuth } from './auth-provider';

/** Pourquoi l'enregistrement push a échoué — pour ne plus l'avaler en
 *  silence (le toggle "Notifications" de account.tsx mentait sinon : activé
 *  côté serveur, mais aucun token jamais envoyé). */
export type PushStatus =
  | 'idle'
  | 'registered'
  | 'unsupported' // simulateur / pas d'appareil physique
  | 'permission_denied'
  | 'missing_config' // extra.eas.projectId absent — build EAS non configuré
  | 'failed';

const PushStatusContext = createContext<PushStatus>('idle');

export function usePushStatus(): PushStatus {
  return useContext(PushStatusContext);
}

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
    shouldShowBanner: true,
    shouldShowList: true,
  }),
});

async function registerForPushNotifications(): Promise<
  { token: string } | { status: Exclude<PushStatus, 'idle' | 'registered'> }
> {
  if (!Device.isDevice) return { status: 'unsupported' };

  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync('default', {
      name: 'MikroLan',
      importance: Notifications.AndroidImportance.HIGH,
      sound: 'default',
    });
  }

  const { status: existing } = await Notifications.getPermissionsAsync();
  let finalStatus = existing;
  if (existing !== 'granted') {
    const { status } = await Notifications.requestPermissionsAsync();
    finalStatus = status;
  }
  if (finalStatus !== 'granted') return { status: 'permission_denied' };

  const projectId = Constants.expoConfig?.extra?.eas?.projectId;
  if (!projectId) return { status: 'missing_config' };

  const { data } = await Notifications.getExpoPushTokenAsync({ projectId });
  return { token: data };
}

export function PushNotificationsProvider({ children }: PropsWithChildren) {
  const { isAuthenticated } = useAuth();
  const registered = useRef(false);
  const [status, setStatus] = useState<PushStatus>('idle');

  useEffect(() => {
    if (!isAuthenticated || registered.current) return;
    registered.current = true;

    registerForPushNotifications()
      .then((result) => {
        if ('token' in result) {
          setStatus('registered');
          api.auth.registerPushToken(result.token).catch(() => setStatus('failed'));
        } else {
          setStatus(result.status);
        }
      })
      .catch(() => setStatus('failed'));
  }, [isAuthenticated]);

  return (
    <PushStatusContext.Provider value={status}>
      {children}
    </PushStatusContext.Provider>
  );
}
