import { createContext, PropsWithChildren, useCallback, useContext, useEffect, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Platform } from 'react-native';

export type ThemeMode = 'light' | 'dark';

const STORAGE_KEY = 'mikrolan_theme_mode';

const mono = Platform.select({ ios: 'Menlo', default: 'monospace' }) as string;

export type ThemeColors = {
  bg: string;
  surface: string;
  surfaceAlt: string;
  border: string;
  text: string;
  textMuted: string;
  textFaint: string;
  primary: string;
  primaryMuted: string;
  primaryText: string;
  /** @deprecated Use primary with withAlpha instead. Kept for migration. */
  primarySoft: string;
  /** Alias for primaryMuted — used where a secondary accent was needed. */
  secondary: string;
  gold: string;
  goldText: string;
  danger: string;
  success: string;
  warning: string;
  mono: string;
  onStrong: string;
};

export const darkColors: ThemeColors = {
  bg: '#09090F',
  surface: '#111118',
  surfaceAlt: '#18181F',
  border: '#222233',
  text: '#EEEEF2',
  textMuted: '#888899',
  textFaint: '#555566',
  primary: '#7B61FF',
  primaryMuted: '#6550D9',
  primaryText: '#FFFFFF',
  primarySoft: '#6550D9',
  secondary: '#6550D9',
  gold: '#E8A317',
  goldText: '#09090F',
  danger: '#E5484D',
  success: '#30A46C',
  warning: '#F5A623',
  mono,
  onStrong: '#FFFFFF',
};

export const lightColors: ThemeColors = {
  bg: '#FAFAFA',
  surface: '#FFFFFF',
  surfaceAlt: '#F2F2F5',
  border: '#E0E0E6',
  text: '#111118',
  textMuted: '#6B6B80',
  textFaint: '#9999AA',
  primary: '#7B61FF',
  primaryMuted: '#6550D9',
  primaryText: '#FFFFFF',
  primarySoft: '#6550D9',
  secondary: '#6550D9',
  gold: '#C78B00',
  goldText: '#FFFFFF',
  danger: '#CD2B31',
  success: '#18794E',
  warning: '#D48D00',
  mono,
  onStrong: '#FFFFFF',
};

type ThemeContextValue = {
  mode: ThemeMode;
  colors: ThemeColors;
  setMode: (mode: ThemeMode) => void;
  toggle: () => void;
};

const ThemeContext = createContext<ThemeContextValue>({
  mode: 'dark',
  colors: darkColors,
  setMode: () => {},
  toggle: () => {},
});

export function ThemeProvider({ children }: PropsWithChildren) {
  const [mode, setModeState] = useState<ThemeMode>('dark');

  useEffect(() => {
    AsyncStorage.getItem(STORAGE_KEY).then((v: string | null) => {
      if (v === 'light' || v === 'dark') setModeState(v);
    }).catch(() => {});
  }, []);

  const setMode = useCallback((m: ThemeMode) => {
    setModeState(m);
    AsyncStorage.setItem(STORAGE_KEY, m).catch(() => {});
  }, []);

  const toggle = useCallback(() => {
    setMode(mode === 'dark' ? 'light' : 'dark');
  }, [mode, setMode]);

  const colors = mode === 'dark' ? darkColors : lightColors;

  return (
    <ThemeContext.Provider value={{ mode, colors, setMode, toggle }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme(): ThemeColors {
  return useContext(ThemeContext).colors;
}

export function useThemeMode() {
  const ctx = useContext(ThemeContext);
  return { mode: ctx.mode, setMode: ctx.setMode, toggle: ctx.toggle };
}
