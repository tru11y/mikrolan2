// MikroLan Connect — Ombres D0 §F.
// Objets prêts à spread dans un ViewStyle React Native.
import { Platform, type ViewStyle } from 'react-native';

export const connectElevation = {
  none: {} as ViewStyle,
  card: Platform.select<ViewStyle>({
    ios: {
      shadowColor: '#3C2800',
      shadowOpacity: 0.10,
      shadowRadius: 10,
      shadowOffset: { width: 0, height: 2 },
    },
    android: { elevation: 2 },
    default: {},
  }) as ViewStyle,
  hero: Platform.select<ViewStyle>({
    ios: {
      shadowColor: '#0B6B5C',
      shadowOpacity: 0.25,
      shadowRadius: 18,
      shadowOffset: { width: 0, height: 6 },
    },
    android: { elevation: 6 },
    default: {},
  }) as ViewStyle,
} as const;

export type ConnectElevationKey = keyof typeof connectElevation;
