import { useEffect, useRef } from 'react';
import { Animated, Text } from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { api } from '@/src/lib/api';
import { useLiveEvents } from '@/src/providers/live-events-provider';
import { Press, useReduceMotion } from './ui';
import { useTheme } from '@/src/providers/theme-provider';

/**
 * Cloche + compteur. Le flux est tenu par `LiveEventsProvider` (sondage 5 s au
 * premier plan) ; ici on ne fait qu'afficher, et on secoue la cloche quand un
 * évènement tombe pour que le changement de badge ne passe pas inaperçu.
 */
export function NotificationBell() {
  const theme = useTheme();
  const router = useRouter();
  const reduced = useReduceMotion();
  const { lastEventAt } = useLiveEvents();

  const unread = useQuery({
    queryKey: ['notifications', 'unread-count'],
    queryFn: api.notifications.unreadCount,
    refetchInterval: 15_000,
    placeholderData: keepPreviousData,
  });
  const count = unread.data ?? 0;

  const shake = useRef(new Animated.Value(0)).current;
  const badgePop = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    if (!lastEventAt || reduced) return;
    Animated.sequence([
      Animated.timing(shake, {
        toValue: 1,
        duration: 90,
        useNativeDriver: true,
      }),
      Animated.timing(shake, {
        toValue: -1,
        duration: 90,
        useNativeDriver: true,
      }),
      Animated.timing(shake, {
        toValue: 0,
        duration: 90,
        useNativeDriver: true,
      }),
    ]).start();
    Animated.sequence([
      Animated.spring(badgePop, {
        toValue: 1.5,
        useNativeDriver: true,
        speed: 30,
        bounciness: 14,
      }),
      Animated.spring(badgePop, {
        toValue: 1,
        useNativeDriver: true,
        speed: 20,
        bounciness: 10,
      }),
    ]).start();
  }, [badgePop, lastEventAt, reduced, shake]);

  return (
    <Press
      accessibilityLabel={
        count > 0 ? `Notifications, ${count} non lues` : 'Notifications'
      }
      onPress={() => router.push('/notifications')}
      scaleTo={0.88}
      style={{
        width: 34,
        height: 34,
        borderRadius: 11,
        borderWidth: 1,
        borderColor: count > 0 ? theme.primary + '66' : theme.border,
        backgroundColor: count > 0 ? theme.primary + '18' : theme.surfaceAlt,
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <Animated.View
        style={{
          transform: [
            {
              rotate: shake.interpolate({
                inputRange: [-1, 1],
                outputRange: ['-14deg', '14deg'],
              }),
            },
          ],
        }}
      >
        <Ionicons
          name={count > 0 ? 'notifications' : 'notifications-outline'}
          size={16}
          color={count > 0 ? theme.primary : theme.text}
        />
      </Animated.View>
      {count > 0 ? (
        <Animated.View
          style={{
            position: 'absolute',
            top: -3,
            right: -3,
            minWidth: 16,
            height: 16,
            borderRadius: 8,
            paddingHorizontal: 3,
            backgroundColor: theme.danger,
            alignItems: 'center',
            justifyContent: 'center',
            borderWidth: 1.5,
            borderColor: theme.surface,
            transform: [{ scale: badgePop }],
          }}
        >
          <Text style={{ color: '#fff', fontSize: 9, fontWeight: '800' }}>
            {count > 9 ? '9+' : count}
          </Text>
        </Animated.View>
      ) : null}
    </Press>
  );
}
