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
  primary: string;
  primarySoft: string;
  primaryText: string;
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
  bg: '#0B0B12',
  surface: '#15151F',
  surfaceAlt: '#1C1C29',
  border: '#2A2A3C',
  text: '#F2F3F8',
  textMuted: '#9AA0B4',
  primary: '#7B61FF',
  primarySoft: '#A78BFA',
  primaryText: '#0B0B12',
  secondary: '#A78BFA',
  gold: '#F5B84A',
  goldText: '#0B0B12',
  danger: '#F87171',
  success: '#34D399',
  warning: '#F5B84A',
  mono,
  onStrong: '#FFFFFF',
};

export const lightColors: ThemeColors = {
  bg: '#FFFFFF',
  surface: '#F5F5F8',
  surfaceAlt: '#EDEDF2',
  border: '#D8D8E0',
  text: '#0B0B12',
  textMuted: '#6B7085',
  primary: '#7B61FF',
  primarySoft: '#A78BFA',
  primaryText: '#FFFFFF',
  secondary: '#A78BFA',
  gold: '#D97706',
  goldText: '#FFFFFF',
  danger: '#DC2626',
  success: '#059669',
  warning: '#D97706',
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
