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

export type IoniconName = keyof typeof Ionicons.glyphMap;

/**
 * "Onyx & Aurora" — dark premium.
 *
 * Une seule règle de couleur, parce que l'app en comptait six qui se
 * disputaient le même écran (violet, cyan, or, vert, ambre, rouge) sans
 * qu'aucune ne veuille dire quelque chose :
 *
 *   violet  → tout ce qui est interactif ou sélectionné (et la marque)
 *   ambre   → l'argent et l'abonnement PRO, rien d'autre
 *   vert    → ça va / c'est actif / c'est payé
 *   rouge   → ça ne va pas / c'est destructif
 *   gris    → tout le reste (information neutre, décor, icônes secondaires)
 *
 * Une couleur ne sert jamais de décoration. Si un élément n'encode aucun de
 * ces cinq sens, il est gris.
 */
export const theme = {
  bg: '#0B0B12', // encre
  surface: '#15151F',
  surfaceAlt: '#1C1C29',
  border: '#2A2A3C',
  text: '#F2F3F8',
  textMuted: '#9AA0B4',
  primary: '#7B61FF', // violet électrique — interactif / marque
  primarySoft: '#A78BFA', // même famille, hiérarchie secondaire
  primaryText: '#0B0B12', // ink label on violet
  /** @deprecated Ancien cyan décoratif : c'était la 4e teinte sans signifié.
   *  Repointé sur la famille violette. Utiliser `primary`/`primarySoft`. */
  secondary: '#A78BFA',
  gold: '#F5B84A', // argent / tier PRO — exclusif
  goldText: '#0B0B12',
  danger: '#F87171',
  success: '#34D399',
  /** Même ambre que `gold` : « attention » et « valeur » partagent une teinte
   *  plutôt que d'en aligner deux presque identiques côte à côte. */
  warning: '#F5B84A',
  mono: Platform.select({ ios: 'Menlo', default: 'monospace' }) as string,
  /** Blanc pur — réservé au contenu posé sur une couleur forte (ex. thumb de
   *  `Switch`, badge de compteur), jamais utilisé comme couleur de texte
   *  courante. `primaryText`/`goldText` restent l'encre sombre habituelle. */
  onStrong: '#FFFFFF',
} as const;

/**
 * Applique une opacité à une couleur hexadécimale (`#RGB` ou `#RRGGBB`) en
 * lui ajoutant un canal alpha, plutôt que de concaténer "22"/"44"/"66" à la
 * main à chaque site d'appel (motif répété ~40 fois dans l'app — fragile dès
 * que la couleur source n'est plus un hex à 6 chiffres).
 *
 * `opacity` est normalisée entre 0 et 1 et bornée. Une couleur qui n'est pas
 * un hex valide (`rgba(...)`, nom CSS…) est renvoyée telle quelle : le
 * helper ne sait pas lui ajouter d'alpha, mais ne casse rien non plus.
 */
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
// Durées et courbes uniques : sans elles chaque écran inventait son timing et
// l'app donnait l'impression de trois applications différentes.

export const motion = {
  fast: 140, // feedback tactile
  base: 220, // apparition d'un élément
  slow: 360, // transition d'écran / gros bloc
  stagger: 55, // décalage entre deux items d'une liste
  /** Décélération type iOS — sort vite, arrive doux. */
  easeOut: Easing.bezier(0.22, 1, 0.36, 1),
  easeIn: Easing.bezier(0.55, 0, 1, 0.45),
} as const;

// ─── Échelles ────────────────────────────────────────────────────────────────
// Sans elles chaque écran réinventait ses tailles en littéraux inline, d'où
// des cartes et des marges qui ne tombaient jamais juste. Toute nouvelle
// dimension passe par ici — pas de nombre nu dans les écrans.

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

/** Graisses de police. Les poids étaient choisis à la main à chaque usage —
 *  avec une convergence de fait (700-800 titres/valeurs, 600 labels, 400
 *  corps) mais rien qui l'impose. Ces tokens rendent la convention explicite. */
export const weight = {
  regular: '400',
  medium: '500',
  semibold: '600',
  bold: '700',
  heavy: '800',
} as const;

// Convention iconographique : variante *outline* = état neutre/inactif,
// variante pleine = état actif/sélectionné (voir BottomNav, NotificationBell).
export const icon = { sm: 16, md: 20, lg: 24, xl: 28 } as const;

// ─── Élévation ───────────────────────────────────────────────────────────────
// Échelle volontairement courte : `none` pour les cartes standards (une
// bordure suffit à les détacher du fond — ne pas ajouter d'ombre dessus),
// `subtle` pour un contenu qui doit sembler légèrement au-dessus (ex. barre
// flottante), `floating` pour le FAB uniquement (glow teinté marque). Chaque
// palier fonctionne identiquement iOS (shadow*) et Android (elevation).
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
      shadowColor: theme.primary,
      shadowOpacity: 0.5,
      shadowRadius: 12,
      shadowOffset: { width: 0, height: 4 },
    },
    android: { elevation: 6 },
    default: {},
  }) as ViewStyle,
} as const;

// ─── Accessibilité du mouvement ──────────────────────────────────────────────
// « Réduire les animations » du système doit couper les nôtres, sinon on rend
// l'app inutilisable pour qui a activé le réglage.

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

/**
 * Apparition : fondu + légère montée. `delay` sert à faire monter une liste en
 * cascade (`index * motion.stagger`) — au-delà de ~8 items le décalage devient
 * de l'attente, donc il est plafonné.
 */
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
] as const;

function pickLayoutStyle(style: StyleProp<ViewStyle> | undefined): ViewStyle {
  const flat = StyleSheet.flatten(style) ?? {};
  const out: ViewStyle = {};
  for (const key of LAYOUT_STYLE_KEYS) {
    const value = (flat as Record<string, unknown>)[key];
    if (value !== undefined) (out as Record<string, unknown>)[key] = value;
  }
  return out;
}

/**
 * Zone tactile avec retour physique (enfoncement + assombrissement). C'est ce
 * qui manquait le plus : rien dans l'app ne réagissait au doigt avant le
 * changement d'écran, ce qui donnait une impression de latence.
 */
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

  // Un `flex: 1` (ou `width`/`height`) dans une Row doit être porté par ce
  // Pressable, le vrai enfant flex de la Row — sinon la Row ne peut pas lui
  // distribuer d'espace et son contenu déborde de l'écran. Mais SEULES les
  // propriétés de mise en page passent ici : dupliquer tout `style` sur les
  // deux couches (background, border, padding...) les fait rendre deux fois
  // et casse le rendu visuel (bordure imbriquée, texte tronqué).
  const layoutStyle = pickLayoutStyle(style);

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
      style={layoutStyle}
    >
      {({ pressed }) => (
        <Animated.View
          style={[
            style,
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

/** Bloc gris pulsant, à la place de « Chargement… » qui ne dit rien de la
 *  forme de ce qui arrive. */
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
          backgroundColor: theme.surfaceAlt,
          opacity: reduced ? 0.6 : pulse,
        },
        style,
      ]}
    />
  );
}

/** Squelette de carte, calé sur les dimensions réelles de `Card`. */
export function SkeletonCard({ lines = 2 }: { lines?: number }) {
  return (
    <View style={styles.card}>
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

/** Compteur qui monte jusqu'à sa valeur — utilisé par les KPI, où un chiffre
 *  qui apparaît d'un coup ne se remarque pas. */
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
  return <View style={styles.screen}>{children}</View>;
}

// Surface élevée standard (fond + bordure + rayon + padding cohérents). À
// utiliser pour tout bloc de contenu autonome (carte de liste, section) ; une
// `View` nue reste légitime pour un conteneur de layout pur (ligne, groupe)
// qui ne représente aucune donnée en lui-même.
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

/** Message d'erreur attaché à un champ. Rouge + icône : la couleur seule ne
 *  suffit pas (daltonisme), et un `Banner` en haut d'écran ne dit pas *quel*
 *  champ est en faute. */
export function FieldError({ children }: { children?: string | null }) {
  if (!children) return null;
  return (
    <Row style={{ justifyContent: 'flex-start', gap: space.xs + 2 }}>
      <Ionicons name="alert-circle" size={13} color={theme.danger} />
      <Text style={{ color: theme.danger, fontSize: type.caption, flex: 1 }}>
        {children}
      </Text>
    </Row>
  );
}

export function Field(
  props: TextInputProps & { label?: string; error?: string | null; hint?: string },
) {
  const { label, error, hint, style, ...rest } = props;
  const invalid = Boolean(error);
  return (
    <View style={{ gap: 6 }}>
      {label ? <Label>{label}</Label> : null}
      <TextInput
        placeholderTextColor={theme.textMuted}
        accessibilityLabel={label}
        accessibilityState={{ disabled: rest.editable === false }}
        style={[styles.input, invalid && styles.inputInvalid, style]}
        {...rest}
      />
      {invalid ? (
        <FieldError>{error}</FieldError>
      ) : hint ? (
        <Text style={{ color: theme.textMuted, fontSize: type.micro }}>{hint}</Text>
      ) : null}
    </View>
  );
}

/**
 * Champ strictement numérique.
 *
 * `keyboardType="number-pad"` ne garantit rien : le clavier physique, le
 * collage et les claviers tiers laissaient passer lettres, espaces et « - ».
 * Ici la valeur est filtrée à la frappe (`0-9` uniquement) et bornée à
 * `maxLength` chiffres ; `min`/`max` sont vérifiés au blur pour ne pas
 * corriger l'utilisateur pendant qu'il tape (taper « 12 » passe par « 1 »,
 * qui serait rejeté à chaque caractère).
 */
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
  /** Vide = valeur absente et non une erreur (ex. « illimité »). */
  optional?: boolean;
  /** Nombre de chiffres saisissables. Par défaut déduit de `max`. */
  maxLength?: number;
  placeholder?: string;
  hint?: string;
  /** Erreur imposée de l'extérieur (serveur). Prioritaire sur la locale. */
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
      // Le filtre vit ici et nulle part ailleurs : chaque écran qui le
      // réécrivait en oubliait un cas (collage, clavier Bluetooth).
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
    <Press
      accessibilityLabel={accessibilityLabel ?? title}
      onPress={onPress}
      disabled={disabled || loading}
      scaleTo={0.98}
      style={[styles.button, { backgroundColor: bg, borderColor: border }]}
    >
      {loading ? (
        <ActivityIndicator color={labelColor} />
      ) : (
        <Text style={[styles.buttonText, { color: labelColor }]}>{title}</Text>
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

export function Empty({
  text,
  icon: iconName,
  action,
}: {
  text: string;
  icon?: IoniconName;
  action?: { label: string; onPress: () => void };
}): ReactNode {
  return (
    <FadeIn style={styles.empty}>
      {iconName ? <IconChip name={iconName} color={theme.textMuted} size="xl" /> : null}
      <Text style={{ color: theme.textMuted, textAlign: 'center' }}>{text}</Text>
      {action ? (
        <View style={{ minWidth: 200 }}>
          <Button title={action.label} variant="ghost" onPress={action.onPress} />
        </View>
      ) : null}
    </FadeIn>
  );
}

/**
 * Écran/section en erreur, avec le moyen d'en sortir.
 *
 * L'app affichait des `Banner` rouges sans issue : le message partait au
 * prochain rendu et l'utilisateur n'avait aucun bouton pour réessayer, donc
 * il tuait l'app. Toute erreur de chargement passe par ici.
 */
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
  return (
    <FadeIn
      style={{
        alignItems: 'center',
        gap: space.md,
        paddingVertical: compact ? space.lg : space.xxxl,
      }}
    >
      <IconChip name="cloud-offline-outline" color={theme.danger} size="xl" outlined />
      <Text
        style={{
          color: theme.text,
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

/**
 * Choix exclusif dans une rangée. Chaque écran redessinait ce bouton avec sa
 * propre couleur d'état (cyan ici, violet là), d'où l'impression que « actif »
 * ne voulait pas dire la même chose d'un écran à l'autre. Une seule couleur :
 * violet = sélectionné.
 */
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
  return (
    <Press
      accessibilityRole="radio"
      accessibilityLabel={title}
      onPress={onPress}
      scaleTo={0.985}
      style={{
        flex: 1,
        borderWidth: 1,
        borderColor: active ? theme.primary : theme.border,
        backgroundColor: active ? theme.primary + '1A' : theme.surfaceAlt,
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
            color={active ? theme.primary : theme.textMuted}
          />
        ) : null}
        <Text
          style={{
            color: active ? theme.text : theme.textMuted,
            fontWeight: '700',
            fontSize: type.caption,
            flex: 1,
          }}
        >
          {title}
        </Text>
        {active ? (
          <Ionicons name="checkmark-circle" size={icon.sm} color={theme.primary} />
        ) : null}
      </Row>
      {desc ? (
        <Text style={{ color: theme.textMuted, fontSize: type.micro - 1 }}>{desc}</Text>
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

export type ActionSheetAction = {
  label: string;
  onPress: () => void;
  tone?: 'default' | 'primary' | 'danger';
  variant?: 'default' | 'cancel';
};

/**
 * Thémé, choix multiples — remplace `Alert.alert` natif (fond blanc, police
 * système) qui rompait le thème en plein parcours PRO (WebFig/SSH/Winbox).
 */
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
  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onClose}
    >
      <View style={styles.dialogBackdrop}>
        <View style={[styles.dialog, { borderColor: theme.border }]}>
          <IconChip name={iconName} color={theme.primary} size="lg" outlined />
          <View style={{ alignItems: 'center', gap: space.xs }}>
            <Text style={styles.dialogTitle}>{title}</Text>
            {message ? (
              <Text
                style={[
                  styles.dialogMessage,
                  mono ? { fontFamily: theme.mono, fontSize: type.caption } : null,
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
                  ? theme.danger
                  : a.tone === 'primary'
                    ? theme.primary
                    : theme.text;
              return (
                <Pressable key={i} onPress={a.onPress} style={styles.actionSheetItem}>
                  <Text
                    style={{
                      color: isCancel ? theme.textMuted : accent,
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

// ─── Toasts ──────────────────────────────────────────────────────────────────

export type ToastTone = 'success' | 'danger' | 'info';

type ToastPayload = { id: number; tone: ToastTone; text: string };

type ToastApi = {
  /** Confirmation ou erreur passagère. Pour une erreur bloquante, utiliser
   *  `ErrorState` : un toast disparaît, une erreur qui empêche d'avancer non. */
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

function toastColor(tone: ToastTone): string {
  return tone === 'success'
    ? theme.success
    : tone === 'danger'
      ? theme.danger
      : theme.primary;
}

function ToastItem({ toast, onDone }: { toast: ToastPayload; onDone: () => void }) {
  const reduced = useReduceMotion();
  const anim = useRef(new Animated.Value(0)).current;

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

  const color = toastColor(toast.tone);

  return (
    <Animated.View
      accessibilityLiveRegion="polite"
      style={[
        styles.toast,
        {
          borderColor: color + '66',
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
      <Ionicons name={TOAST_ICON[toast.tone]} size={icon.md} color={color} />
      <Text style={styles.toastText}>{toast.text}</Text>
    </Animated.View>
  );
}

export function ToastProvider({ children }: PropsWithChildren) {
  const [toasts, setToasts] = useState<ToastPayload[]>([]);
  const nextId = useRef(1);

  const api = useMemo<ToastApi>(() => {
    const show = (text: string, tone: ToastTone = 'info') => {
      const id = nextId.current++;
      // Un évènement qui se répète (ex. connexion routeur qui flappe) ne doit
      // pas empiler le même message : on remplace le doublon au lieu de
      // l'ajouter, sinon l'utilisateur voit le même texte s'enchaîner.
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
      <View pointerEvents="none" style={styles.toastHost}>
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
  inputInvalid: { borderColor: theme.danger, backgroundColor: theme.danger + '10' },
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
    backgroundColor: theme.surfaceAlt,
    borderWidth: 1,
    borderRadius: radius.md,
    paddingVertical: space.md,
    paddingHorizontal: space.lg - 2,
  },
  toastText: { color: theme.text, fontSize: type.body, flex: 1, fontWeight: '600' },
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
    gap: space.md,
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
  actionSheetItem: {
    width: '100%',
    paddingVertical: space.md,
    borderRadius: radius.md,
    backgroundColor: theme.surfaceAlt,
    borderWidth: 1,
    borderColor: theme.border,
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
