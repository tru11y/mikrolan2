import { useEffect, useRef } from 'react';
import { Animated, Easing } from 'react-native';
import type { RouterHealth } from '@/src/lib/api';
import { routerHealth, toneColor } from './ui';

/**
 * Pastille de statut réutilisée liste + détail. Clignote seulement quand
 * ONLINE — un routeur hors ligne ou inconnu reste fixe (pas de fausse
 * impression d'activité sur un état "mort" ou "jamais vérifié").
 */
export function RouterStatusDot({
  health,
  size = 9,
}: {
  health: RouterHealth;
  size?: number;
}) {
  const pulse = useRef(new Animated.Value(1)).current;
  const online = health === 'ONLINE';

  useEffect(() => {
    if (!online) {
      pulse.setValue(1);
      return;
    }
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, {
          toValue: 0.3,
          duration: 700,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
        Animated.timing(pulse, {
          toValue: 1,
          duration: 700,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [online, pulse]);

  const color = toneColor(routerHealth(health).tone);

  return (
    <Animated.View
      style={{
        width: size,
        height: size,
        borderRadius: size / 2,
        backgroundColor: color,
        opacity: online ? pulse : 1,
      }}
    />
  );
}
