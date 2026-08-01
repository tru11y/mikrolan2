import { View, Text, ScrollView } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter, usePathname } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from '@/src/providers/auth-provider';
import {
  Button,
  Card,
  IconChip,
  Row,
  icon,
  radius,
  space,
  theme,
  type,
} from './ui';

// Écrans qui restent accessibles une fois l'essai terminé : le client doit
// pouvoir se connecter, voir son compte et payer.
const OPEN_ROUTES = ['/login', '/pro', '/(tabs)/account', '/account'];

const LOCKED_FEATURES: { icon: Parameters<typeof IconChip>[0]['name']; label: string }[] = [
  { icon: 'hardware-chip-outline', label: 'Vos routeurs' },
  { icon: 'ticket-outline', label: 'Génération de tickets' },
  { icon: 'layers-outline', label: 'Forfaits WiFi' },
  { icon: 'bar-chart-outline', label: 'Rapport financier' },
];

/**
 * Cadenas global. Monté une fois au-dessus de la navigation : plutôt que de
 * parsemer chaque écran de conditions, on couvre l'app entière dès que le
 * serveur nous dit que le compte est verrouillé.
 *
 * Ce n'est qu'un miroir : l'API refuse déjà les requêtes d'un compte verrouillé
 * (EntitlementGuard). Contourner cet écran ne donnerait accès à rien.
 */
export function PaywallLock() {
  const { isAuthenticated, isLocked } = useAuth();
  const router = useRouter();
  const pathname = usePathname();
  const insets = useSafeAreaInsets();

  if (!isAuthenticated || !isLocked) return null;
  if (OPEN_ROUTES.some((r) => pathname.startsWith(r))) return null;

  return (
    <View
      style={{
        position: 'absolute',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        backgroundColor: theme.bg,
      }}
    >
      <ScrollView
        contentContainerStyle={{
          flexGrow: 1,
          justifyContent: 'center',
          padding: space.xxl,
          paddingTop: insets.top + space.xxl,
          paddingBottom: insets.bottom + space.xxl,
          gap: space.xl,
        }}
      >
        <View style={{ alignItems: 'center', gap: space.md }}>
          <View
            style={{
              width: 72,
              height: 72,
              borderRadius: radius.xl,
              backgroundColor: theme.gold + '22',
              borderWidth: 1,
              borderColor: theme.gold + '55',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <Ionicons name="lock-closed" size={32} color={theme.gold} />
          </View>
          <Text
            style={{
              color: theme.text,
              fontSize: type.h1,
              fontWeight: '800',
              textAlign: 'center',
            }}
          >
            Votre essai est terminé
          </Text>
          <Text
            style={{
              color: theme.textMuted,
              fontSize: type.bodyLg,
              textAlign: 'center',
            }}
          >
            Activez un forfait PRO pour retrouver vos routeurs, vos tickets et
            votre chiffre d’affaires — et piloter vos routeurs à distance,
            partout.
          </Text>
        </View>

        <Card style={{ gap: space.md }}>
          {LOCKED_FEATURES.map((f) => (
            <Row key={f.label} style={{ justifyContent: 'flex-start', gap: space.md }}>
              <IconChip name={f.icon} color={theme.textMuted} size="sm" />
              <Text
                style={{ color: theme.textMuted, fontSize: type.body, flex: 1 }}
              >
                {f.label}
              </Text>
              <Ionicons
                name="lock-closed"
                size={icon.sm}
                color={theme.textMuted}
              />
            </Row>
          ))}
        </Card>

        <View style={{ gap: space.md }}>
          <Button
            title="Activer mon forfait PRO"
            variant="gold"
            onPress={() => router.push('/pro')}
          />
          <Button
            title="Mon compte"
            variant="ghost"
            onPress={() => router.push('/(tabs)/account')}
          />
        </View>

        <Text
          style={{
            color: theme.textMuted,
            fontSize: type.micro,
            textAlign: 'center',
          }}
        >
          Vos routeurs et vos tickets sont conservés. Tout revient dès
          l’activation.
        </Text>
      </ScrollView>
    </View>
  );
}
