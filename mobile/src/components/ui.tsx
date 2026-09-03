import {
  createContext,
  PropsWithChildren,
  ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  AccessibilityInfo,
  ActivityIndicator,
  Animated,
  Easing,
  Modal,
  Platform,
  Pressable,
  StyleProp,
  StyleSheet,
  Text,
  TextInput,
  TextInputProps,
  TextStyle,
  Vibration,
  View,
  ViewStyle,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import { useTheme, type ThemeColors, darkColors } from '@/src/providers/theme-provider';

export type IoniconName = keyof typeof Ionicons.glyphMap;

// Re-export for backward compatibility — non-component code that cannot call
// hooks (elevation, standalone helpers) uses this dark-only fallback.
export const theme = darkColors;

export function withAlpha(hex: string, opacity: number): string {
  const match = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.exec(hex);
  if (!match) return hex;
  const clamped = Math.max(0, Math.min(1, opacity));
  const normalized =
    match[1].length === 3
      ? match[1]
          .split('')
          .map((c) => c + c)
          .join('')
      : match[1];
  const alphaHex = Math.round(clamped * 255)
    .toString(16)
    .padStart(2, '0');
  return `#${normalized}${alphaHex}`;
}

// ─── Mouvement ───────────────────────────────────────────────────────────────

export const motion = {
  fast: 140,
  base: 220,
  slow: 360,
  stagger: 55,
  easeOut: Easing.bezier(0.22, 1, 0.36, 1),
  easeIn: Easing.bezier(0.55, 0, 1, 0.45),
} as const;

// ─── Échelles ────────────────────────────────────────────────────────────────

export const radius = { xs: 4, sm: 10, md: 12, lg: 16, xl: 20, pill: 999 } as const;

export const space = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  xxl: 24,
  xxxl: 32,
} as const;

export const type = {
  micro: 11,
  caption: 12,
  body: 13,
  bodyLg: 15,
  title: 17,
  h2: 20,
  h1: 24,
  display: 32,
  hero: 40,
} as const;

export const weight = {
  regular: '400',
  medium: '500',
  semibold: '600',
  bold: '700',
  heavy: '800',
} as const;

export const icon = { sm: 16, md: 20, lg: 24, xl: 28 } as const;

// ─── Élévation ───────────────────────────────────────────────────────────────

export const elevation = {
  none: {} as ViewStyle,
  subtle: Platform.select<ViewStyle>({
    ios: {
      shadowColor: '#000000',
      shadowOpacity: 0.16,
      shadowRadius: 6,
      shadowOffset: { width: 0, height: 2 },
    },
    android: { elevation: 3 },
    default: {},
  }) as ViewStyle,
  floating: Platform.select<ViewStyle>({
    ios: {
      shadowColor: '#7B61FF',
      shadowOpacity: 0.5,
      shadowRadius: 12,
      shadowOffset: { width: 0, height: 4 },
    },
    android: { elevation: 6 },
    default: {},
  }) as ViewStyle,
} as const;

// ─── Themed styles ──────────────────────────────────────────────────────────

function makeStyles(t: ThemeColors) {
  return StyleSheet.create({
    screen: { flex: 1, backgroundColor: t.bg, padding: space.lg },
    card: {
      backgroundColor: t.surface,
      borderRadius: radius.lg,
      borderWidth: 1,
      borderColor: t.border,
      padding: space.lg,
      gap: space.md,
    },
    title: { color: t.text, fontSize: type.h1, fontWeight: '700' },
    subtitle: { color: t.textMuted, fontSize: type.body },
    label: { color: t.textMuted, fontSize: type.body, fontWeight: '600' },
    input: {
      backgroundColor: t.surfaceAlt,
      borderWidth: 1,
      borderColor: t.border,
      borderRadius: radius.sm,
      paddingHorizontal: space.md,
      paddingVertical: space.md,
      color: t.text,
      fontSize: type.bodyLg,
    },
    inputInvalid: { borderColor: t.danger, backgroundColor: withAlpha(t.danger, 0.06) },
    toastHost: {
      position: 'absolute',
      top: 0,
      left: 0,
      right: 0,
      paddingTop: 56,
      paddingHorizontal: space.lg,
      gap: space.sm,
    },
    toast: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: space.md,
      backgroundColor: t.surfaceAlt,
      borderWidth: 1,
      borderRadius: radius.md,
      paddingVertical: space.md,
      paddingHorizontal: space.lg - 2,
    },
    toastText: { color: t.text, fontSize: type.body, flex: 1, fontWeight: '600' },
    button: {
      borderRadius: radius.sm,
      borderWidth: 1,
      paddingVertical: space.lg - 2,
      alignItems: 'center',
      justifyContent: 'center',
    },
    buttonText: { fontSize: type.bodyLg, fontWeight: '700' },
    badge: {
      borderWidth: 1,
      borderRadius: radius.pill,
      paddingHorizontal: space.sm + 2,
      paddingVertical: 3,
      alignSelf: 'flex-start',
    },
    badgeText: {
      fontSize: type.micro,
      fontWeight: '700',
      fontFamily: t.mono,
      textTransform: 'uppercase',
      letterSpacing: 0.4,
    },
    banner: {
      borderWidth: 1,
      borderRadius: radius.sm,
      padding: space.md,
      backgroundColor: t.surface,
    },
    empty: {
      padding: space.xxxl,
      alignItems: 'center',
      justifyContent: 'center',
      gap: space.md,
    },
    monoText: { color: t.text, fontFamily: t.mono, fontSize: type.body },
    sectionTitle: {
      color: t.text,
      fontSize: type.title,
      fontWeight: '700',
      marginBottom: space.sm,
    },
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
    },
    stat: {
      flex: 1,
      backgroundColor: t.surface,
      borderRadius: radius.lg,
      borderWidth: 1,
      borderColor: t.border,
      paddingVertical: space.lg - 2,
      paddingHorizontal: space.md,
      gap: space.xs + 2,
    },
    statValue: { fontSize: type.h1, fontWeight: '800' },
    statLabel: { color: t.textMuted, fontSize: type.micro },
    pill: {
      borderWidth: 1,
      borderRadius: radius.pill,
      paddingHorizontal: space.lg - 2,
      paddingVertical: space.sm - 1,
    },
    pillText: { fontSize: type.body, fontWeight: '600' },
    aurora: { borderRadius: radius.xl, padding: space.xl },
    dialogBackdrop: {
      flex: 1,
      backgroundColor: '#000000cc',
      alignItems: 'center',
      justifyContent: 'center',
      padding: space.lg,
    },
    dialog: {
      width: '100%',
      maxWidth: 360,
      backgroundColor: t.surface,
      borderWidth: 1,
      borderRadius: radius.lg,
      padding: space.xl,
      gap: space.lg,
      alignItems: 'center',
    },
    dialogTitle: {
      color: t.text,
      fontSize: type.title,
      fontWeight: '700',
      textAlign: 'center',
    },
    dialogMessage: {
      color: t.textMuted,
      fontSize: type.body,
      textAlign: 'center',
    },
    dialogCancel: {
      flex: 1,
      paddingVertical: space.md,
      borderRadius: radius.md,
      backgroundColor: t.surfaceAlt,
      alignItems: 'center',
    },
    actionSheetItem: {
      width: '100%',
      paddingVertical: space.md,
      borderRadius: radius.md,
      backgroundColor: t.surfaceAlt,
      borderWidth: 1,
      borderColor: t.border,
      alignItems: 'center',
    },
    dialogCancelText: {
      color: t.textMuted,
      fontWeight: '700',
      fontSize: type.body,
    },
    dialogConfirm: {
      flex: 1,
      paddingVertical: space.md,
      borderRadius: radius.md,
      alignItems: 'center',
    },
    dialogConfirmText: {
      color: t.text,
      fontWeight: '700',
      fontSize: type.body,
    },
  });
}

const darkStyles = makeStyles(darkColors);
const stylesCache = new Map<ThemeColors, ReturnType<typeof makeStyles>>();
stylesCache.set(darkColors, darkStyles);

export function useStyles() {
  const t = useTheme();
  return useMemo(() => {
    const cached = stylesCache.get(t);
    if (cached) return cached;
    const s = makeStyles(t);
    stylesCache.set(t, s);
    return s;
  }, [t]);
}

// ─── Accessibilité du mouvement ──────────────────────────────────────────────

let reduceMotionCache = false;
AccessibilityInfo.isReduceMotionEnabled()
  .then((v) => {
    reduceMotionCache = v;
  })
  .catch(() => {});

export function useReduceMotion(): boolean {
  const [reduced, setReduced] = useState(reduceMotionCache);
  useEffect(() => {
    let alive = true;
    AccessibilityInfo.isReduceMotionEnabled()
      .then((v) => {
        reduceMotionCache = v;
        if (alive) setReduced(v);
      })
      .catch(() => {});
    const sub = AccessibilityInfo.addEventListener(
      'reduceMotionChanged',
      (v: boolean) => {
        reduceMotionCache = v;
        if (alive) setReduced(v);
      },
    );
    return () => {
      alive = false;
      sub.remove();
    };
  }, []);
  return reduced;
}

// ─── Primitives animées ──────────────────────────────────────────────────────

export function FadeIn({
  children,
  delay = 0,
  from = 10,
  style,
}: PropsWithChildren<{ delay?: number; from?: number; style?: ViewStyle }>) {
  const reduced = useReduceMotion();
  const progress = useRef(new Animated.Value(reduced ? 1 : 0)).current;

  useEffect(() => {
    if (reduced) {
      progress.setValue(1);
      return;
    }
    const anim = Animated.timing(progress, {
      toValue: 1,
      duration: motion.base,
      delay: Math.min(delay, motion.stagger * 8),
      easing: motion.easeOut,
      useNativeDriver: true,
    });
    anim.start();
    return () => anim.stop();
  }, [delay, progress, reduced]);

  return (
    <Animated.View
      style={[
        style,
        {
          opacity: progress,
          transform: [
            {
              translateY: progress.interpolate({
                inputRange: [0, 1],
                outputRange: [from, 0],
              }),
            },
          ],
        },
      ]}
    >
      {children}
    </Animated.View>
  );
}

const LAYOUT_STYLE_KEYS = [
  'flex',
  'flexGrow',
  'flexShrink',
  'flexBasis',
  'alignSelf',
  'width',
  'height',
  'minWidth',
  'maxWidth',
  'minHeight',
  'maxHeight',
  'position',
  'top',
  'right',
  'bottom',
  'left',
  'zIndex',
] as const;

function splitPressStyle(style: StyleProp<ViewStyle> | undefined): {
  layout: ViewStyle;
  visual: ViewStyle;
} {
  const flat = (StyleSheet.flatten(style) ?? {}) as Record<string, unknown>;
  const layout: Record<string, unknown> = {};
  const visual: Record<string, unknown> = {};
  const layoutKeys = new Set<string>(LAYOUT_STYLE_KEYS);
  for (const [key, value] of Object.entries(flat)) {
    if (value === undefined) continue;
    (layoutKeys.has(key) ? layout : visual)[key] = value;
  }
  return { layout: layout as ViewStyle, visual: visual as ViewStyle };
}

export function Press({
  children,
  onPress,
  onLongPress,
  disabled,
  scaleTo = 0.97,
  style,
  accessibilityLabel,
  accessibilityHint,
  accessibilityRole = 'button',
  hitSlop,
}: PropsWithChildren<{
  onPress?: () => void;
  onLongPress?: () => void;
  disabled?: boolean;
  scaleTo?: number;
  style?: StyleProp<ViewStyle>;
  accessibilityLabel?: string;
  accessibilityHint?: string;
  accessibilityRole?: 'button' | 'link' | 'radio' | 'tab';
  hitSlop?: number;
}>) {
  const reduced = useReduceMotion();
  const scale = useRef(new Animated.Value(1)).current;

  const animate = useCallback(
    (to: number) => {
      if (reduced) return;
      Animated.spring(scale, {
        toValue: to,
        useNativeDriver: true,
        speed: 40,
        bounciness: 4,
      }).start();
    },
    [reduced, scale],
  );

  const { layout, visual } = splitPressStyle(style);

  return (
    <Pressable
      accessibilityRole={accessibilityRole}
      accessibilityLabel={accessibilityLabel}
      accessibilityHint={accessibilityHint}
      accessibilityState={{ disabled: Boolean(disabled) }}
      onPress={onPress}
      onLongPress={onLongPress}
      onPressIn={() => animate(scaleTo)}
      onPressOut={() => animate(1)}
      disabled={disabled}
      hitSlop={hitSlop}
      style={layout}
    >
      {({ pressed }) => (
        <Animated.View
          style={[
            visual,
            {
              transform: [{ scale }],
              opacity: disabled ? 0.45 : pressed ? 0.9 : 1,
            },
          ]}
        >
          {children}
        </Animated.View>
      )}
    </Pressable>
  );
}

export function Skeleton({
  height = 16,
  width = '100%',
  radius: r = radius.sm,
  style,
}: {
  height?: number;
  width?: number | `${number}%`;
  radius?: number;
  style?: ViewStyle;
}) {
  const t = useTheme();
  const reduced = useReduceMotion();
  const pulse = useRef(new Animated.Value(0.4)).current;

  useEffect(() => {
    if (reduced) return;
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, {
          toValue: 1,
          duration: 700,
          easing: motion.easeOut,
          useNativeDriver: true,
        }),
        Animated.timing(pulse, {
          toValue: 0.4,
          duration: 700,
          easing: motion.easeIn,
          useNativeDriver: true,
        }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [pulse, reduced]);

  return (
    <Animated.View
      accessibilityLabel="Chargement"
      style={[
        {
          height,
          width,
          borderRadius: r,
          backgroundColor: t.surfaceAlt,
          opacity: reduced ? 0.6 : pulse,
        },
        style,
      ]}
    />
  );
}

export function SkeletonCard({ lines = 2 }: { lines?: number }) {
  const s = useStyles();
  return (
    <View style={s.card}>
      <Row style={{ gap: space.md, justifyContent: 'flex-start' }}>
        <Skeleton height={40} width={40} radius={radius.md} />
        <View style={{ flex: 1, gap: space.sm }}>
          <Skeleton height={14} width="60%" />
          <Skeleton height={11} width="35%" />
        </View>
      </Row>
      {Array.from({ length: lines }).map((_, i) => (
        <Skeleton key={i} height={11} width={i === lines - 1 ? '45%' : '100%'} />
      ))}
    </View>
  );
}

export function AnimatedNumber({
  value,
  format = (n: number) => String(Math.round(n)),
  style,
}: {
  value: number;
  format?: (n: number) => string;
  style?: TextStyle;
}) {
  const reduced = useReduceMotion();
  const [shown, setShown] = useState(reduced ? value : 0);
  const anim = useRef(new Animated.Value(0)).current;
  const previous = useRef(0);

  useEffect(() => {
    if (reduced) {
      setShown(value);
      previous.current = value;
      return;
    }
    const from = previous.current;
    anim.setValue(0);
    const id = anim.addListener(({ value: t }) => {
      setShown(from + (value - from) * t);
    });
    const run = Animated.timing(anim, {
      toValue: 1,
      duration: motion.slow,
      easing: motion.easeOut,
      useNativeDriver: false,
    });
    run.start(() => {
      previous.current = value;
    });
    return () => {
      run.stop();
      anim.removeListener(id);
    };
  }, [anim, reduced, value]);

  return <Text style={style}>{format(shown)}</Text>;
}

export function Screen({ children }: PropsWithChildren) {
  const s = useStyles();
  return <View style={s.screen}>{children}</View>;
}

export function Card({
  children,
  style,
}: PropsWithChildren<{ style?: ViewStyle }>) {
  const s = useStyles();
  return <View style={[s.card, style]}>{children}</View>;
}

export function Title({ children }: PropsWithChildren) {
  const s = useStyles();
  return <Text style={s.title}>{children}</Text>;
}

export function Subtitle({ children }: PropsWithChildren) {
  const s = useStyles();
  return <Text style={s.subtitle}>{children}</Text>;
}

export function Label({ children }: PropsWithChildren) {
  const s = useStyles();
  return <Text style={s.label}>{children}</Text>;
}

export function FieldError({ children }: { children?: string | null }) {
  const t = useTheme();
  if (!children) return null;
  return (
    <Row style={{ justifyContent: 'flex-start', gap: space.xs + 2 }}>
      <Ionicons name="alert-circle" size={13} color={t.danger} />
      <Text style={{ color: t.danger, fontSize: type.caption, flex: 1 }}>
        {children}
      </Text>
    </Row>
  );
}

export function Field(
  props: TextInputProps & { label?: string; error?: string | null; hint?: string },
) {
  const t = useTheme();
  const s = useStyles();
  const { label, error, hint, style, ...rest } = props;
  const invalid = Boolean(error);
  return (
    <View style={{ gap: 6 }}>
      {label ? <Label>{label}</Label> : null}
      <TextInput
        placeholderTextColor={t.textMuted}
        accessibilityLabel={label}
        accessibilityState={{ disabled: rest.editable === false }}
        style={[s.input, invalid && s.inputInvalid, style]}
        {...rest}
      />
      {invalid ? (
        <FieldError>{error}</FieldError>
      ) : hint ? (
        <Text style={{ color: t.textMuted, fontSize: type.micro }}>{hint}</Text>
      ) : null}
    </View>
  );
}

export function NumberField({
  label,
  value,
  onChangeValue,
  min,
  max,
  maxLength,
  placeholder,
  hint,
  error,
  optional,
  onValidityChange,
  editable = true,
}: {
  label?: string;
  value: string;
  onChangeValue: (v: string) => void;
  min?: number;
  max?: number;
  optional?: boolean;
  maxLength?: number;
  placeholder?: string;
  hint?: string;
  error?: string | null;
  onValidityChange?: (valid: boolean) => void;
  editable?: boolean;
}) {
  const [touched, setTouched] = useState(false);
  const digits = maxLength ?? (max !== undefined ? String(max).length : 9);

  const localError = useMemo(() => {
    if (value === '') return optional ? null : 'Obligatoire.';
    const n = Number.parseInt(value, 10);
    if (Number.isNaN(n)) return 'Chiffres uniquement.';
    if (min !== undefined && n < min) return `Minimum ${min}.`;
    if (max !== undefined && n > max) return `Maximum ${max}.`;
    return null;
  }, [max, min, optional, value]);

  useEffect(() => {
    onValidityChange?.(localError === null);
  }, [localError, onValidityChange]);

  return (
    <Field
      label={label}
      value={value}
      onChangeText={(v) => onChangeValue(v.replace(/[^0-9]/g, '').slice(0, digits))}
      onBlur={() => setTouched(true)}
      keyboardType="number-pad"
      inputMode="numeric"
      maxLength={digits}
      placeholder={placeholder}
      hint={hint}
      editable={editable}
      error={error ?? (touched ? localError : null)}
    />
  );
}

export function OutlinedField({
  label,
  value,
  onChangeText,
  secureTextEntry,
  onToggleSecure,
  autoCapitalize,
  keyboardType,
  autoComplete,
  placeholder,
}: {
  label: string;
  value: string;
  onChangeText: (v: string) => void;
  secureTextEntry?: boolean;
  onToggleSecure?: () => void;
  autoCapitalize?: 'none' | 'words' | 'characters';
  keyboardType?: TextInputProps['keyboardType'];
  autoComplete?: TextInputProps['autoComplete'];
  placeholder?: string;
}) {
  const t = useTheme();
  return (
    <View>
      <View
        style={{
          position: 'absolute',
          top: -8,
          left: 12,
          backgroundColor: t.bg,
          paddingHorizontal: 6,
          zIndex: 1,
        }}
      >
        <Text style={{ color: t.textMuted, fontSize: 12 }}>{label}</Text>
      </View>
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          borderWidth: 1,
          borderColor: t.border,
          borderRadius: 14,
          paddingHorizontal: 16,
        }}
      >
        <TextInput
          value={value}
          onChangeText={onChangeText}
          placeholder={placeholder}
          placeholderTextColor={t.textMuted}
          secureTextEntry={secureTextEntry}
          autoCapitalize={autoCapitalize ?? 'none'}
          keyboardType={keyboardType}
          autoComplete={autoComplete}
          style={{
            flex: 1,
            color: t.text,
            fontSize: 16,
            fontWeight: '600',
            paddingVertical: 16,
          }}
        />
        {onToggleSecure ? (
          <Pressable onPress={onToggleSecure} hitSlop={10}>
            <Ionicons
              name={secureTextEntry ? 'eye-outline' : 'eye-off-outline'}
              size={20}
              color={t.textMuted}
            />
          </Pressable>
        ) : null}
      </View>
    </View>
  );
}

export function Button({
  title,
  onPress,
  loading,
  variant = 'primary',
  disabled,
  accessibilityLabel,
}: {
  title: string;
  onPress: () => void;
  loading?: boolean;
  variant?: 'primary' | 'ghost' | 'danger' | 'gold';
  disabled?: boolean;
  accessibilityLabel?: string;
}) {
  const t = useTheme();
  const s = useStyles();
  const bg =
    variant === 'primary'
      ? t.primary
      : variant === 'gold'
        ? t.gold
        : 'transparent';
  const border =
    variant === 'ghost'
      ? t.border
      : variant === 'danger'
        ? t.danger
        : bg;
  const labelColor =
    variant === 'primary'
      ? t.primaryText
      : variant === 'gold'
        ? t.goldText
        : variant === 'danger'
          ? t.danger
          : t.text;
  return (
    <Press
      accessibilityLabel={accessibilityLabel ?? title}
      onPress={onPress}
      disabled={disabled || loading}
      scaleTo={0.98}
      style={[s.button, { backgroundColor: bg, borderColor: border }]}
    >
      {loading ? (
        <ActivityIndicator color={labelColor} />
      ) : (
        <Text style={[s.buttonText, { color: labelColor }]}>{title}</Text>
      )}
    </Press>
  );
}

export type Tone =
  | 'muted'
  | 'success'
  | 'danger'
  | 'warning'
  | 'primary'
  | 'secondary'
  | 'gold';

export function useToneColor() {
  const t = useTheme();
  return useCallback((tone: Tone): string => {
    switch (tone) {
      case 'success': return t.success;
      case 'danger': return t.danger;
      case 'warning': return t.warning;
      case 'primary': return t.primary;
      case 'secondary': return t.secondary;
      case 'gold': return t.gold;
      default: return t.textMuted;
    }
  }, [t]);
}

export function toneColor(tone: Tone): string {
  switch (tone) {
    case 'success': return theme.success;
    case 'danger': return theme.danger;
    case 'warning': return theme.warning;
    case 'primary': return theme.primary;
    case 'secondary': return theme.secondary;
    case 'gold': return theme.gold;
    default: return theme.textMuted;
  }
}

export function routerHealth(h: 'UNKNOWN' | 'ONLINE' | 'OFFLINE' | 'ERROR'): {
  label: string;
  tone: Tone;
} {
  switch (h) {
    case 'ONLINE': return { label: 'En ligne', tone: 'success' };
    case 'OFFLINE': return { label: 'Hors ligne', tone: 'warning' };
    case 'ERROR': return { label: 'Erreur', tone: 'danger' };
    default: return { label: 'Inconnu', tone: 'muted' };
  }
}

export function Badge({
  label,
  tone = 'muted',
}: {
  label: string;
  tone?: Tone;
}) {
  const s = useStyles();
  const getToneColor = useToneColor();
  const color = getToneColor(tone);
  return (
    <View style={[s.badge, { borderColor: color }]}>
      <Text style={[s.badgeText, { color }]}>{label}</Text>
    </View>
  );
}

export function Banner({
  children,
  tone = 'danger',
}: PropsWithChildren<{ tone?: 'danger' | 'success' | 'warning' }>) {
  const t = useTheme();
  const s = useStyles();
  const color =
    tone === 'success'
      ? t.success
      : tone === 'warning'
        ? t.warning
        : t.danger;
  return (
    <View style={[s.banner, { borderColor: color }]}>
      <Text style={{ color }}>{children}</Text>
    </View>
  );
}

export function Empty({
  text,
  icon: iconName,
  action,
}: {
  text: string;
  icon?: IoniconName;
  action?: { label: string; onPress: () => void };
}): ReactNode {
  const t = useTheme();
  const s = useStyles();
  return (
    <FadeIn style={s.empty}>
      {iconName ? <IconChip name={iconName} color={t.textMuted} size="xl" /> : null}
      <Text style={{ color: t.textMuted, textAlign: 'center' }}>{text}</Text>
      {action ? (
        <View style={{ minWidth: 200 }}>
          <Button title={action.label} variant="ghost" onPress={action.onPress} />
        </View>
      ) : null}
    </FadeIn>
  );
}

export function ErrorState({
  message,
  onRetry,
  retrying,
  compact,
}: {
  message: string;
  onRetry?: () => void;
  retrying?: boolean;
  compact?: boolean;
}) {
  const t = useTheme();
  return (
    <FadeIn
      style={{
        alignItems: 'center',
        gap: space.md,
        paddingVertical: compact ? space.lg : space.xxxl,
      }}
    >
      <IconChip name="cloud-offline-outline" color={t.danger} size="xl" outlined />
      <Text
        style={{
          color: t.text,
          fontSize: type.body,
          textAlign: 'center',
          paddingHorizontal: space.lg,
        }}
      >
        {message}
      </Text>
      {onRetry ? (
        <View style={{ minWidth: 200 }}>
          <Button title="Réessayer" variant="ghost" onPress={onRetry} loading={retrying} />
        </View>
      ) : null}
    </FadeIn>
  );
}

type Accent = 'text' | 'primary' | 'secondary' | 'gold' | 'success' | 'danger';

function useAccentColor() {
  const t = useTheme();
  return useCallback((a: Accent): string => {
    switch (a) {
      case 'primary': return t.primary;
      case 'secondary': return t.secondary;
      case 'gold': return t.gold;
      case 'success': return t.success;
      case 'danger': return t.danger;
      default: return t.text;
    }
  }, [t]);
}

export function Mono({
  children,
  style,
}: PropsWithChildren<{ style?: TextStyle }>) {
  const s = useStyles();
  return <Text style={[s.monoText, style]}>{children}</Text>;
}

export function SectionTitle({ children }: PropsWithChildren) {
  const s = useStyles();
  return <Text style={s.sectionTitle}>{children}</Text>;
}

export function Row({
  children,
  style,
}: PropsWithChildren<{ style?: ViewStyle }>) {
  const s = useStyles();
  return <View style={[s.row, style]}>{children}</View>;
}

export function Stat({
  value,
  label,
  tone = 'text',
  icon,
  style,
}: {
  value: string;
  label: string;
  tone?: Accent;
  icon?: IoniconName;
  style?: ViewStyle;
}) {
  const s = useStyles();
  const accentColor = useAccentColor();
  const c = accentColor(tone);
  return (
    <View style={[s.stat, style]}>
      {icon ? <IconChip name={icon} color={c} size="sm" /> : null}
      <Text style={[s.statValue, { color: c }]}>{value}</Text>
      <Text style={s.statLabel}>{label}</Text>
    </View>
  );
}

export function Pill({
  label,
  active,
  onPress,
  tone = 'primary',
}: {
  label: string;
  active?: boolean;
  onPress?: () => void;
  tone?: Accent;
}) {
  const t = useTheme();
  const s = useStyles();
  const accentColor = useAccentColor();
  const accent = accentColor(tone === 'text' ? 'primary' : tone);
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={[
        s.pill,
        {
          borderColor: active ? accent : t.border,
          backgroundColor: active ? withAlpha(accent, 0.13) : 'transparent',
        },
      ]}
    >
      <Text style={[s.pillText, { color: active ? accent : t.textMuted }]}>
        {label}
      </Text>
    </Pressable>
  );
}

const CHIP = {
  sm: { box: 32, glyph: icon.sm, radius: radius.sm },
  md: { box: 40, glyph: icon.md, radius: radius.md },
  lg: { box: 48, glyph: icon.lg, radius: radius.lg },
  xl: { box: 56, glyph: icon.xl, radius: radius.lg },
} as const;

export function IconChip({
  name,
  color,
  size = 'md',
  outlined,
}: {
  name: IoniconName;
  color?: string;
  size?: keyof typeof CHIP;
  outlined?: boolean;
}) {
  const t = useTheme();
  const c = color ?? t.primary;
  const sz = CHIP[size];
  return (
    <View
      style={{
        width: sz.box,
        height: sz.box,
        borderRadius: sz.radius,
        backgroundColor: withAlpha(c, 0.13),
        borderWidth: outlined ? 1 : 0,
        borderColor: withAlpha(c, 0.27),
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <Ionicons name={name} size={sz.glyph} color={c} />
    </View>
  );
}

export function SegmentedOption({
  active,
  onPress,
  title,
  desc,
  icon: iconName,
}: {
  active: boolean;
  onPress: () => void;
  title: string;
  desc?: string;
  icon?: IoniconName;
}) {
  const t = useTheme();
  return (
    <Press
      accessibilityRole="radio"
      accessibilityLabel={title}
      onPress={onPress}
      scaleTo={0.985}
      style={{
        flex: 1,
        borderWidth: 1,
        borderColor: active ? t.primary : t.border,
        backgroundColor: active ? withAlpha(t.primary, 0.1) : t.surfaceAlt,
        borderRadius: radius.md,
        padding: space.md - 2,
        gap: space.xs,
      }}
    >
      <Row style={{ justifyContent: 'flex-start', gap: space.sm }}>
        {iconName ? (
          <Ionicons
            name={iconName}
            size={icon.sm}
            color={active ? t.primary : t.textMuted}
          />
        ) : null}
        <Text
          style={{
            color: active ? t.text : t.textMuted,
            fontWeight: '700',
            fontSize: type.caption,
            flex: 1,
          }}
        >
          {title}
        </Text>
        {active ? (
          <Ionicons name="checkmark-circle" size={icon.sm} color={t.primary} />
        ) : null}
      </Row>
      {desc ? (
        <Text style={{ color: t.textMuted, fontSize: type.micro - 1 }}>{desc}</Text>
      ) : null}
    </Press>
  );
}

export function ScreenHeader({
  title,
  subtitle,
}: {
  title: string;
  subtitle?: string;
}) {
  return (
    <View style={{ gap: space.xs }}>
      <Title>{title}</Title>
      {subtitle ? <Subtitle>{subtitle}</Subtitle> : null}
    </View>
  );
}

export function ConfirmDialog({
  visible,
  icon: iconName,
  title,
  message,
  confirmLabel,
  cancelLabel = 'Annuler',
  tone = 'danger',
  busy,
  banner,
  onConfirm,
  onCancel,
}: {
  visible: boolean;
  icon: IoniconName;
  title: string;
  message: string;
  confirmLabel: string;
  cancelLabel?: string;
  tone?: 'danger' | 'primary';
  busy?: boolean;
  banner?: { tone: 'success' | 'danger'; text: string } | null;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const t = useTheme();
  const s = useStyles();
  const accent = tone === 'danger' ? t.danger : t.primary;
  const done = banner?.tone === 'success';
  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onCancel}
    >
      <View style={s.dialogBackdrop}>
        <View style={[s.dialog, { borderColor: withAlpha(accent, 0.4) }]}>
          <IconChip name={iconName} color={accent} size="lg" outlined />
          <View style={{ alignItems: 'center', gap: space.xs }}>
            <Text style={s.dialogTitle}>{title}</Text>
            <Text style={s.dialogMessage}>{message}</Text>
          </View>
          {banner ? <Banner tone={banner.tone}>{banner.text}</Banner> : null}
          <Row style={{ gap: space.sm, width: '100%' }}>
            <Pressable onPress={onCancel} style={s.dialogCancel}>
              <Text style={s.dialogCancelText}>
                {done ? 'Fermer' : cancelLabel}
              </Text>
            </Pressable>
            {done ? null : (
              <Pressable
                onPress={onConfirm}
                disabled={busy}
                style={[
                  s.dialogConfirm,
                  { backgroundColor: accent, opacity: busy ? 0.6 : 1 },
                ]}
              >
                <Text style={s.dialogConfirmText}>
                  {busy ? 'Patientez…' : confirmLabel}
                </Text>
              </Pressable>
            )}
          </Row>
        </View>
      </View>
    </Modal>
  );
}

export type ActionSheetAction = {
  label: string;
  onPress: () => void;
  tone?: 'default' | 'primary' | 'danger';
  variant?: 'default' | 'cancel';
};

export function ActionSheet({
  visible,
  icon: iconName,
  title,
  message,
  mono,
  actions,
  onClose,
}: {
  visible: boolean;
  icon: IoniconName;
  title: string;
  message?: string;
  mono?: boolean;
  actions: ActionSheetAction[];
  onClose: () => void;
}) {
  const t = useTheme();
  const s = useStyles();
  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onClose}
    >
      <View style={s.dialogBackdrop}>
        <View style={[s.dialog, { borderColor: t.border }]}>
          <IconChip name={iconName} color={t.primary} size="lg" outlined />
          <View style={{ alignItems: 'center', gap: space.xs }}>
            <Text style={s.dialogTitle}>{title}</Text>
            {message ? (
              <Text
                style={[
                  s.dialogMessage,
                  mono ? { fontFamily: t.mono, fontSize: type.caption } : null,
                ]}
              >
                {message}
              </Text>
            ) : null}
          </View>
          <View style={{ gap: space.sm, width: '100%' }}>
            {actions.map((a, i) => {
              const isCancel = a.variant === 'cancel';
              const accent =
                a.tone === 'danger'
                  ? t.danger
                  : a.tone === 'primary'
                    ? t.primary
                    : t.text;
              return (
                <Pressable key={i} onPress={a.onPress} style={s.actionSheetItem}>
                  <Text
                    style={{
                      color: isCancel ? t.textMuted : accent,
                      fontWeight: '700',
                      fontSize: type.body,
                    }}
                  >
                    {a.label}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        </View>
      </View>
    </Modal>
  );
}

export function AuroraCard({
  children,
  style,
}: PropsWithChildren<{ style?: ViewStyle }>) {
  const t = useTheme();
  const s = useStyles();
  return (
    <LinearGradient
      colors={[t.primary, t.secondary]}
      start={{ x: 0, y: 0 }}
      end={{ x: 1, y: 1 }}
      style={[s.aurora, style]}
    >
      {children}
    </LinearGradient>
  );
}

// ─── Toasts ──────────────────────────────────────────────────────────────────

export type ToastTone = 'success' | 'danger' | 'info';

type ToastPayload = { id: number; tone: ToastTone; text: string };

type ToastApi = {
  show: (text: string, tone?: ToastTone) => void;
  success: (text: string) => void;
  error: (text: string) => void;
};

const ToastContext = createContext<ToastApi | null>(null);

const TOAST_ICON: Record<ToastTone, IoniconName> = {
  success: 'checkmark-circle',
  danger: 'alert-circle',
  info: 'information-circle',
};

function ToastItem({ toast, onDone }: { toast: ToastPayload; onDone: () => void }) {
  const t = useTheme();
  const s = useStyles();
  const reduced = useReduceMotion();
  const anim = useRef(new Animated.Value(0)).current;

  const toastColor =
    toast.tone === 'success'
      ? t.success
      : toast.tone === 'danger'
        ? t.danger
        : t.primary;

  useEffect(() => {
    const enter = Animated.timing(anim, {
      toValue: 1,
      duration: reduced ? 0 : motion.base,
      easing: motion.easeOut,
      useNativeDriver: true,
    });
    const exit = Animated.timing(anim, {
      toValue: 0,
      duration: reduced ? 0 : motion.fast,
      delay: 3200,
      easing: motion.easeIn,
      useNativeDriver: true,
    });
    const seq = Animated.sequence([enter, exit]);
    seq.start(({ finished }) => {
      if (finished) onDone();
    });
    return () => seq.stop();
  }, [anim, onDone, reduced]);

  return (
    <Animated.View
      accessibilityLiveRegion="polite"
      style={[
        s.toast,
        {
          borderColor: withAlpha(toastColor, 0.4),
          opacity: anim,
          transform: [
            {
              translateY: anim.interpolate({
                inputRange: [0, 1],
                outputRange: [-16, 0],
              }),
            },
          ],
        },
      ]}
    >
      <Ionicons name={TOAST_ICON[toast.tone]} size={icon.md} color={toastColor} />
      <Text style={s.toastText}>{toast.text}</Text>
    </Animated.View>
  );
}

export function ToastProvider({ children }: PropsWithChildren) {
  const s = useStyles();
  const [toasts, setToasts] = useState<ToastPayload[]>([]);
  const nextId = useRef(1);

  const api = useMemo<ToastApi>(() => {
    const show = (text: string, tone: ToastTone = 'info') => {
      const id = nextId.current++;
      setToasts((list) => {
        const last = list[list.length - 1];
        const dedup = last && last.tone === tone && last.text === text ? list.slice(0, -1) : list.slice(-1);
        return [...dedup, { id, tone, text }];
      });
      if (tone === 'danger') Vibration.vibrate(30);
    };
    return {
      show,
      success: (text: string) => show(text, 'success'),
      error: (text: string) => show(text, 'danger'),
    };
  }, []);

  const dismiss = useCallback((id: number) => {
    setToasts((list) => list.filter((t) => t.id !== id));
  }, []);

  return (
    <ToastContext.Provider value={api}>
      {children}
      <View pointerEvents="none" style={s.toastHost}>
        {toasts.map((t) => (
          <ToastItem key={t.id} toast={t} onDone={() => dismiss(t.id)} />
        ))}
      </View>
    </ToastContext.Provider>
  );
}

export function useToast(): ToastApi {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast doit être utilisé sous <ToastProvider>.');
  return ctx;
}
