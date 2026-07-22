import { PropsWithChildren, ReactNode } from 'react';
import {
  ActivityIndicator,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  TextInputProps,
  TextStyle,
  View,
  ViewStyle,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';

export type IoniconName = keyof typeof Ionicons.glyphMap;

// "Onyx & Aurora" identity — dark premium. See project_mikrolan2_stitch_redesign.
export const theme = {
  bg: '#0B0B12', // encre
  surface: '#15151F',
  surfaceAlt: '#1C1C29',
  border: '#2A2A3C',
  text: '#F2F3F8',
  textMuted: '#9AA0B4',
  primary: '#7B61FF', // violet électrique (brand/tech)
  primaryText: '#0B0B12', // ink label on violet
  secondary: '#22D3EE', // cyan signal (data/réseau)
  gold: '#F5B84A', // encode le tier PRO (money)
  goldText: '#0B0B12',
  danger: '#F87171',
  success: '#34D399',
  warning: '#FBBF24',
  mono: Platform.select({ ios: 'Menlo', default: 'monospace' }) as string,
} as const;

export function Screen({ children }: PropsWithChildren) {
  return <View style={styles.screen}>{children}</View>;
}

export function Card({
  children,
  style,
}: PropsWithChildren<{ style?: ViewStyle }>) {
  return <View style={[styles.card, style]}>{children}</View>;
}

export function Title({ children }: PropsWithChildren) {
  return <Text style={styles.title}>{children}</Text>;
}

export function Subtitle({ children }: PropsWithChildren) {
  return <Text style={styles.subtitle}>{children}</Text>;
}

export function Label({ children }: PropsWithChildren) {
  return <Text style={styles.label}>{children}</Text>;
}

export function Field(props: TextInputProps & { label?: string }) {
  const { label, ...rest } = props;
  return (
    <View style={{ gap: 6 }}>
      {label ? <Label>{label}</Label> : null}
      <TextInput
        placeholderTextColor={theme.textMuted}
        style={styles.input}
        {...rest}
      />
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
  const bg =
    variant === 'primary'
      ? theme.primary
      : variant === 'gold'
        ? theme.gold
        : 'transparent'; // ghost + danger are outline
  const border =
    variant === 'ghost'
      ? theme.border
      : variant === 'danger'
        ? theme.danger
        : bg;
  const labelColor =
    variant === 'primary'
      ? theme.primaryText
      : variant === 'gold'
        ? theme.goldText
        : variant === 'danger'
          ? theme.danger
          : theme.text;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? title}
      onPress={onPress}
      disabled={disabled || loading}
      style={({ pressed }) => [
        styles.button,
        {
          backgroundColor: bg,
          borderColor: border,
          opacity: disabled ? 0.5 : pressed ? 0.85 : 1,
        },
      ]}
    >
      {loading ? (
        <ActivityIndicator color={labelColor} />
      ) : (
        <Text style={[styles.buttonText, { color: labelColor }]}>{title}</Text>
      )}
    </Pressable>
  );
}

export function Badge({
  label,
  tone = 'muted',
}: {
  label: string;
  tone?:
    | 'muted'
    | 'success'
    | 'danger'
    | 'warning'
    | 'primary'
    | 'secondary'
    | 'gold';
}) {
  const color =
    tone === 'success'
      ? theme.success
      : tone === 'danger'
        ? theme.danger
        : tone === 'warning'
          ? theme.warning
          : tone === 'primary'
            ? theme.primary
            : tone === 'secondary'
              ? theme.secondary
              : tone === 'gold'
                ? theme.gold
                : theme.textMuted;
  return (
    <View style={[styles.badge, { borderColor: color }]}>
      <Text style={[styles.badgeText, { color }]}>{label}</Text>
    </View>
  );
}

export function Banner({
  children,
  tone = 'danger',
}: PropsWithChildren<{ tone?: 'danger' | 'success' | 'warning' }>) {
  const color =
    tone === 'success'
      ? theme.success
      : tone === 'warning'
        ? theme.warning
        : theme.danger;
  return (
    <View style={[styles.banner, { borderColor: color }]}>
      <Text style={{ color }}>{children}</Text>
    </View>
  );
}

export function Empty({ text }: { text: string }): ReactNode {
  return (
    <View style={styles.empty}>
      <Text style={{ color: theme.textMuted, textAlign: 'center' }}>{text}</Text>
    </View>
  );
}

type Accent = 'text' | 'primary' | 'secondary' | 'gold' | 'success' | 'danger';

function accentColor(a: Accent): string {
  switch (a) {
    case 'primary':
      return theme.primary;
    case 'secondary':
      return theme.secondary;
    case 'gold':
      return theme.gold;
    case 'success':
      return theme.success;
    case 'danger':
      return theme.danger;
    default:
      return theme.text;
  }
}

export function Mono({
  children,
  style,
}: PropsWithChildren<{ style?: TextStyle }>) {
  return <Text style={[styles.monoText, style]}>{children}</Text>;
}

export function SectionTitle({ children }: PropsWithChildren) {
  return <Text style={styles.sectionTitle}>{children}</Text>;
}

export function Row({
  children,
  style,
}: PropsWithChildren<{ style?: ViewStyle }>) {
  return <View style={[styles.row, style]}>{children}</View>;
}

// KPI tile: icon chip + big value + label, optional accent color.
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
  const c = accentColor(tone);
  return (
    <View style={[styles.stat, style]}>
      {icon ? (
        <View style={[styles.statIcon, { backgroundColor: c + '22' }]}>
          <Ionicons name={icon} size={16} color={c} />
        </View>
      ) : null}
      <Text style={[styles.statValue, { color: c }]}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}

// Small filter/segmented pill.
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
  const accent = accentColor(tone === 'text' ? 'primary' : tone);
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={[
        styles.pill,
        {
          borderColor: active ? accent : theme.border,
          backgroundColor: active ? accent + '22' : 'transparent',
        },
      ]}
    >
      <Text style={[styles.pillText, { color: active ? accent : theme.textMuted }]}>
        {label}
      </Text>
    </Pressable>
  );
}

// Aurora gradient surface (violet -> cyan) for hero / revenue cards.
export function AuroraCard({
  children,
  style,
}: PropsWithChildren<{ style?: ViewStyle }>) {
  return (
    <LinearGradient
      colors={[theme.primary, theme.secondary]}
      start={{ x: 0, y: 0 }}
      end={{ x: 1, y: 1 }}
      style={[styles.aurora, style]}
    >
      {children}
    </LinearGradient>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: theme.bg, padding: 16 },
  card: {
    backgroundColor: theme.surface,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: theme.border,
    padding: 16,
    gap: 12,
  },
  title: { color: theme.text, fontSize: 22, fontWeight: '700' },
  subtitle: { color: theme.textMuted, fontSize: 14 },
  label: { color: theme.textMuted, fontSize: 13, fontWeight: '600' },
  input: {
    backgroundColor: theme.surfaceAlt,
    borderWidth: 1,
    borderColor: theme.border,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 12,
    color: theme.text,
    fontSize: 15,
  },
  button: {
    borderRadius: 10,
    borderWidth: 1,
    paddingVertical: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  buttonText: { fontSize: 15, fontWeight: '700' },
  badge: {
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 3,
    alignSelf: 'flex-start',
  },
  badgeText: {
    fontSize: 11,
    fontWeight: '700',
    fontFamily: theme.mono,
    textTransform: 'uppercase',
    letterSpacing: 0.4,
  },
  banner: {
    borderWidth: 1,
    borderRadius: 10,
    padding: 12,
    backgroundColor: theme.surface,
  },
  empty: { padding: 32, alignItems: 'center', justifyContent: 'center' },
  monoText: { color: theme.text, fontFamily: theme.mono, fontSize: 13 },
  sectionTitle: {
    color: theme.text,
    fontSize: 16,
    fontWeight: '700',
    marginBottom: 8,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  stat: {
    flex: 1,
    backgroundColor: theme.surface,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: theme.border,
    paddingVertical: 14,
    paddingHorizontal: 12,
    gap: 6,
  },
  statIcon: {
    width: 30,
    height: 30,
    borderRadius: 9,
    alignItems: 'center',
    justifyContent: 'center',
  },
  statValue: { fontSize: 22, fontWeight: '800' },
  statLabel: { color: theme.textMuted, fontSize: 11.5 },
  pill: {
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 14,
    paddingVertical: 7,
  },
  pillText: { fontSize: 13, fontWeight: '600' },
  aurora: { borderRadius: 20, padding: 20 },
});
