import { View, Text, ScrollView } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter, usePathname } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { useAuth } from '@/src/providers/auth-provider';
import {
  Button,
  Card,
  IconChip,
  Row,
  icon,
  radius,
  space,
  type,
  withAlpha,
} from './ui';
import { useTheme } from '@/src/providers/theme-provider';

// Écrans qui restent accessibles une fois l'essai terminé : le client doit
// pouvoir se connecter, voir son compte et payer.
const OPEN_ROUTES = ['/login', '/pro', '/(tabs)/account', '/account'];

const LOCKED_FEATURE_ICONS: { icon: Parameters<typeof IconChip>[0]['name']; key: string }[] = [
  { icon: 'hardware-chip-outline', key: 'paywall.yourRouters' },
  { icon: 'ticket-outline', key: 'paywall.ticketGeneration' },
  { icon: 'layers-outline', key: 'paywall.wifiPlans' },
  { icon: 'bar-chart-outline', key: 'paywall.financialReport' },
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
  const theme = useTheme();
  const { t } = useTranslation();
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
              backgroundColor: withAlpha(theme.gold, 0.13),
              borderWidth: 0,
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
            {t('paywall.trialEnded')}
          </Text>
          <Text
            style={{
              color: theme.textMuted,
              fontSize: type.bodyLg,
              textAlign: 'center',
            }}
          >
            {t('paywall.trialEndedDetail')}
          </Text>
        </View>

        <Card style={{ gap: space.md }}>
          {LOCKED_FEATURE_ICONS.map((f) => (
            <Row key={f.key} style={{ justifyContent: 'flex-start', gap: space.md }}>
              <IconChip name={f.icon} color={theme.textMuted} size="sm" />
              <Text
                style={{ color: theme.textMuted, fontSize: type.body, flex: 1 }}
              >
                {t(f.key)}
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
            title={t('paywall.activatePro')}
            variant="gold"
            onPress={() => router.push('/pro')}
          />
          <Button
            title={t('paywall.myAccount')}
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
          {t('paywall.dataKept')}
        </Text>
      </ScrollView>
    </View>
  );
}
