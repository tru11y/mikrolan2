import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  PropsWithChildren,
} from 'react';
import { Platform } from 'react-native';
import { router } from 'expo-router';
import { useQueryClient } from '@tanstack/react-query';
import * as Notifications from 'expo-notifications';
import * as Device from 'expo-device';
import Constants from 'expo-constants';
import { api } from '@/src/lib/api';
import { Sentry } from '@/src/lib/sentry';
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

async function ensureChannel(): Promise<void> {
  if (Platform.OS !== 'android') return;
  // Même identifiant que le "channelId: 'default'" envoyé par le backend —
  // recréer ce channel avec des paramètres différents à chaque lancement le
  // laisserait figé sur ses réglages d'origine (Android ignore les updates).
  await Notifications.setNotificationChannelAsync('default', {
    name: 'MikroLan',
    importance: Notifications.AndroidImportance.HIGH,
    sound: 'default',
    lightColor: '#0B0B12',
  });
}

async function registerForPushNotifications(): Promise<
  { token: string } | { status: Exclude<PushStatus, 'idle' | 'registered'> }
> {
  if (!Device.isDevice) return { status: 'unsupported' };

  await ensureChannel();

  const { status: existing } = await Notifications.getPermissionsAsync();
  let finalStatus = existing;
  if (existing !== 'granted') {
    const { status } = await Notifications.requestPermissionsAsync();
    finalStatus = status;
  }
  if (finalStatus !== 'granted') return { status: 'permission_denied' };

  const projectId =
    Constants.expoConfig?.extra?.eas?.projectId
    ?? Constants.easConfig?.projectId
    ?? '73cb9269-d193-4456-860f-982803af4a06';
  if (!projectId) return { status: 'missing_config' };

  const { data } = await Notifications.getExpoPushTokenAsync({ projectId });
  return { token: data };
}

/** Types de notification autorisés à déclencher une navigation — jamais une
 *  route arbitraire venant du payload (mobile/CLAUDE.md, section sécurité). */
function routeForNotification(data: Record<string, unknown> | undefined): string | null {
  if (!data) return null;
  const type = data.type;
  if (type === 'VOUCHER_ACTIVATED' && typeof data.routerId === 'string') {
    return `/router/${data.routerId}`;
  }
  if (type === 'PAYMENT_REJECTED' || type === 'SUBSCRIPTION_ACTIVATED') {
    return '/pro';
  }
  // TICKET_REPLY et tout type inconnu : pas d'écran dédié → centre de
  // notifications, jamais une navigation à l'aveugle.
  return '/notifications';
}

// Dédup process-wide : un même notificationId ne doit jamais être traité deux
// fois (reçu au premier plan puis re-livré par un relance de app state, etc).
const seenNotificationIds = new Set<string>();

export function markSeen(data: Record<string, unknown> | undefined): boolean {
  const id = data?.notificationId;
  if (typeof id !== 'string') return false;
  if (seenNotificationIds.has(id)) return true;
  seenNotificationIds.add(id);
  return false;
}

export function PushNotificationsProvider({ children }: PropsWithChildren) {
  const { isAuthenticated } = useAuth();
  const registered = useRef(false);
  const respondedToColdStart = useRef(false);
  const [status, setStatus] = useState<PushStatus>('idle');
  const qc = useQueryClient();

  useEffect(() => {
    if (!isAuthenticated || registered.current) return;
    registered.current = true;

    registerForPushNotifications()
      .then((result) => {
        if ('token' in result) {
          setStatus('registered');
          api.auth.registerPushToken(result.token).catch((e) => {
            Sentry.captureException(e);
            setStatus('failed');
          });
        } else {
          setStatus(result.status);
        }
      })
      .catch((e) => {
        Sentry.captureException(e);
        setStatus('failed');
      });
  }, [isAuthenticated]);

  // FCM peut renouveler le token à tout moment (réinstall, restore, rotation
  // Google Play Services) — sans ce listener, le serveur garde l'ancien token
  // mort et le push s'arrête silencieusement.
  useEffect(() => {
    const sub = Notifications.addPushTokenListener((event) => {
      if (isAuthenticated) {
        api.auth.registerPushToken(event.data).catch(() => {});
      }
    });
    return () => sub.remove();
  }, [isAuthenticated]);

  useEffect(() => {
    const sub = Notifications.addNotificationReceivedListener((notification) => {
      const data = notification.request.content.data as Record<string, unknown> | undefined;
      if (data?.fromSse) return;
      if (markSeen(data)) {
        Notifications.dismissNotificationAsync(notification.request.identifier).catch(() => {});
        return;
      }
      qc.invalidateQueries({ queryKey: ['notifications'] });
    });
    return () => sub.remove();
  }, [qc]);

  // Appui sur la notification — arrière-plan ou premier plan.
  useEffect(() => {
    const sub = Notifications.addNotificationResponseReceivedListener((response) => {
      const data = response.notification.request.content.data as
        | Record<string, unknown>
        | undefined;
      markSeen(data);
      qc.invalidateQueries({ queryKey: ['notifications'] });
      const target = routeForNotification(data);
      if (target && isAuthenticated) router.push(target as never);
    });
    return () => sub.remove();
  }, [qc, isAuthenticated]);

  // Application totalement fermée puis lancée par un appui sur la
  // notification : la réponse n'arrive pas via un listener mais doit être
  // récupérée explicitement, une fois l'auth prête pour que router.push
  // n'atterrisse pas sur un écran encore verrouillé.
  useEffect(() => {
    if (!isAuthenticated || respondedToColdStart.current) return;
    respondedToColdStart.current = true;
    Notifications.getLastNotificationResponseAsync()
      .then((response) => {
        if (!response) return;
        const data = response.notification.request.content.data as
          | Record<string, unknown>
          | undefined;
        const target = routeForNotification(data);
        if (target) router.push(target as never);
      })
      .catch(() => {});
  }, [isAuthenticated]);

  return (
    <PushStatusContext.Provider value={status}>
      {children}
    </PushStatusContext.Provider>
  );
}
