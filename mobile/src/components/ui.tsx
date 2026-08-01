import { PropsWithChildren, ReactNode } from 'react';
import {
  ActivityIndicator,
  Modal,
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

// ─── Échelles ────────────────────────────────────────────────────────────────
// Sans elles chaque écran réinventait ses tailles en littéraux inline, d'où
// des cartes et des marges qui ne tombaient jamais juste. Toute nouvelle
// dimension passe par ici — pas de nombre nu dans les écrans.

export const radius = { sm: 10, md: 12, lg: 16, xl: 20, pill: 999 } as const;

export const space = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  xxl: 24,
  xxxl: 32,
} as const;

// `micro` est le plancher de lisibilité : rien en dessous de 11.
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

export const icon = { sm: 16, md: 20, lg: 24, xl: 28 } as const;

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

// Outlined field with a floating label notched into the top border —
// matches the real app's input style (verified from device screenshots,
// not the approximate reference code dump).
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
  return (
    <View>
      <View
        style={{
          position: 'absolute',
          top: -8,
          left: 12,
          backgroundColor: theme.bg,
          paddingHorizontal: 6,
          zIndex: 1,
        }}
      >
        <Text style={{ color: theme.textMuted, fontSize: 12 }}>{label}</Text>
      </View>
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          borderWidth: 1,
          borderColor: theme.border,
          borderRadius: 14,
          paddingHorizontal: 16,
        }}
      >
        <TextInput
          value={value}
          onChangeText={onChangeText}
          placeholder={placeholder}
          placeholderTextColor={theme.textMuted}
          secureTextEntry={secureTextEntry}
          autoCapitalize={autoCapitalize ?? 'none'}
          keyboardType={keyboardType}
          autoComplete={autoComplete}
          style={{
            flex: 1,
            color: theme.text,
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
              color={theme.textMuted}
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

export type Tone =
  | 'muted'
  | 'success'
  | 'danger'
  | 'warning'
  | 'primary'
  | 'secondary'
  | 'gold';

export function toneColor(tone: Tone): string {
  switch (tone) {
    case 'success':
      return theme.success;
    case 'danger':
      return theme.danger;
    case 'warning':
      return theme.warning;
    case 'primary':
      return theme.primary;
    case 'secondary':
      return theme.secondary;
    case 'gold':
      return theme.gold;
    default:
      return theme.textMuted;
  }
}

/**
 * Single source of truth for how a router's state reads. Three screens each had
 * their own mapping: the same ONLINE router was cyan here, green there, and
 * labelled "EN LIGNE" in the list but "CONNECTÉ" in the detail.
 */
export function routerHealth(h: 'UNKNOWN' | 'ONLINE' | 'OFFLINE' | 'ERROR'): {
  label: string;
  tone: Tone;
} {
  switch (h) {
    case 'ONLINE':
      return { label: 'En ligne', tone: 'success' };
    case 'OFFLINE':
      return { label: 'Hors ligne', tone: 'warning' };
    case 'ERROR':
      return { label: 'Erreur', tone: 'danger' };
    default:
      return { label: 'Inconnu', tone: 'muted' };
  }
}

export function Badge({
  label,
  tone = 'muted',
}: {
  label: string;
  tone?: Tone;
}) {
  const color = toneColor(tone);
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
      {icon ? <IconChip name={icon} color={c} size="sm" /> : null}
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

const CHIP = {
  sm: { box: 32, glyph: icon.sm, radius: radius.sm },
  md: { box: 40, glyph: icon.md, radius: radius.md },
  lg: { box: 48, glyph: icon.lg, radius: radius.lg },
  xl: { box: 56, glyph: icon.xl, radius: radius.lg },
} as const;

// The tinted rounded square behind an icon — it was rewritten by hand in a
// dozen screens, each with its own size and radius.
export function IconChip({
  name,
  color = theme.primary,
  size = 'md',
  outlined,
}: {
  name: IoniconName;
  color?: string;
  size?: keyof typeof CHIP;
  outlined?: boolean;
}) {
  const s = CHIP[size];
  return (
    <View
      style={{
        width: s.box,
        height: s.box,
        borderRadius: s.radius,
        backgroundColor: color + '22',
        borderWidth: outlined ? 1 : 0,
        borderColor: color + '44',
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <Ionicons name={name} size={s.glyph} color={color} />
    </View>
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

// Confirmation for anything destructive. Uses a real Modal so it covers the
// bottom nav and answers the Android back button.
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
  const accent = tone === 'danger' ? theme.danger : theme.primary;
  const done = banner?.tone === 'success';
  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onCancel}
    >
      <View style={styles.dialogBackdrop}>
        <View style={[styles.dialog, { borderColor: accent + '66' }]}>
          <IconChip name={iconName} color={accent} size="lg" outlined />
          <View style={{ alignItems: 'center', gap: space.xs }}>
            <Text style={styles.dialogTitle}>{title}</Text>
            <Text style={styles.dialogMessage}>{message}</Text>
          </View>
          {banner ? <Banner tone={banner.tone}>{banner.text}</Banner> : null}
          <Row style={{ gap: space.sm, width: '100%' }}>
            <Pressable onPress={onCancel} style={styles.dialogCancel}>
              <Text style={styles.dialogCancelText}>
                {done ? 'Fermer' : cancelLabel}
              </Text>
            </Pressable>
            {done ? null : (
              <Pressable
                onPress={onConfirm}
                disabled={busy}
                style={[
                  styles.dialogConfirm,
                  { backgroundColor: accent, opacity: busy ? 0.6 : 1 },
                ]}
              >
                <Text style={styles.dialogConfirmText}>
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
  screen: { flex: 1, backgroundColor: theme.bg, padding: space.lg },
  card: {
    backgroundColor: theme.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: theme.border,
    padding: space.lg,
    gap: space.md,
  },
  title: { color: theme.text, fontSize: type.h1, fontWeight: '700' },
  subtitle: { color: theme.textMuted, fontSize: type.body },
  label: { color: theme.textMuted, fontSize: type.body, fontWeight: '600' },
  input: {
    backgroundColor: theme.surfaceAlt,
    borderWidth: 1,
    borderColor: theme.border,
    borderRadius: radius.sm,
    paddingHorizontal: space.md,
    paddingVertical: space.md,
    color: theme.text,
    fontSize: type.bodyLg,
  },
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
    fontFamily: theme.mono,
    textTransform: 'uppercase',
    letterSpacing: 0.4,
  },
  banner: {
    borderWidth: 1,
    borderRadius: radius.sm,
    padding: space.md,
    backgroundColor: theme.surface,
  },
  empty: {
    padding: space.xxxl,
    alignItems: 'center',
    justifyContent: 'center',
  },
  monoText: { color: theme.text, fontFamily: theme.mono, fontSize: type.body },
  sectionTitle: {
    color: theme.text,
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
    backgroundColor: theme.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: theme.border,
    paddingVertical: space.lg - 2,
    paddingHorizontal: space.md,
    gap: space.xs + 2,
  },
  statValue: { fontSize: type.h1, fontWeight: '800' },
  statLabel: { color: theme.textMuted, fontSize: type.micro },
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
    backgroundColor: theme.surface,
    borderWidth: 1,
    borderRadius: radius.lg,
    padding: space.xl,
    gap: space.lg,
    alignItems: 'center',
  },
  dialogTitle: {
    color: theme.text,
    fontSize: type.title,
    fontWeight: '700',
    textAlign: 'center',
  },
  dialogMessage: {
    color: theme.textMuted,
    fontSize: type.body,
    textAlign: 'center',
  },
  dialogCancel: {
    flex: 1,
    paddingVertical: space.md,
    borderRadius: radius.md,
    backgroundColor: theme.surfaceAlt,
    alignItems: 'center',
  },
  dialogCancelText: {
    color: theme.textMuted,
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
    color: theme.text,
    fontWeight: '700',
    fontSize: type.body,
  },
});
