import { PropsWithChildren, ReactNode } from 'react';
import {
  ActivityIndicator,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  TextInputProps,
  View,
  ViewStyle,
} from 'react-native';

// "Network console" identity — dark-first. See project_mikrolan2_design.
export const theme = {
  bg: '#0a0e17',
  surface: '#131a29',
  surfaceAlt: '#1b2438',
  border: '#28324c',
  text: '#e8eef7',
  textMuted: '#8695b0',
  primary: '#2de1c2', // signal teal
  primaryText: '#05231f', // ink label on teal
  gold: '#e6b450', // encodes the PRO tier
  goldText: '#2c2208',
  danger: '#f26d6d',
  success: '#3ecf8e',
  warning: '#f5a623',
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
  tone?: 'muted' | 'success' | 'danger' | 'warning' | 'primary' | 'gold';
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
});
