import { useEffect, useRef, PropsWithChildren } from 'react';
import { Platform } from 'react-native';
import * as Notifications from 'expo-notifications';
import * as Device from 'expo-device';
import { api } from '@/src/lib/api';
import { useAuth } from './auth-provider';

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
    shouldShowBanner: true,
    shouldShowList: true,
  }),
});

async function registerForPushNotifications(): Promise<string | null> {
  if (!Device.isDevice) return null;

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
  if (finalStatus !== 'granted') return null;

  const { data } = await Notifications.getExpoPushTokenAsync({
    projectId: undefined as unknown as string,
  });
  return data;
}

export function PushNotificationsProvider({ children }: PropsWithChildren) {
  const { isAuthenticated } = useAuth();
  const registered = useRef(false);

  useEffect(() => {
    if (!isAuthenticated || registered.current) return;
    registered.current = true;

    registerForPushNotifications()
      .then((token) => {
        if (token) api.auth.registerPushToken(token).catch(() => {});
      })
      .catch(() => {});
  }, [isAuthenticated]);

  return <>{children}</>;
}
