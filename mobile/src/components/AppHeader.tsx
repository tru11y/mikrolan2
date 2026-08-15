import { View, Text, Pressable } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/src/lib/api';
import { useActiveRouter } from '@/src/providers/active-router-provider';
import { NotificationBell } from './NotificationBell';
import { icon, radius, routerHealth, space, theme, toneColor, type } from './ui';

export const HEADER_HEIGHT = 56;

/**
 * The app's only header. There used to be three — the native Stack header, a
 * global TopBar and a router TopBar — so titles appeared twice, the bar changed
 * height between modes, and the typography switched mid-navigation.
 *
 * `title` names the screen. When a router is selected its name and real state
 * show underneath, so the router context is never lost.
 */
export function AppHeader({ title, back }: { title: string; back?: boolean }) {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { activeRouterId } = useActiveRouter();

  const routerQuery = useQuery({
    queryKey: ['router', activeRouterId],
    queryFn: () => api.routers.get(activeRouterId as string),
    enabled: Boolean(activeRouterId),
  });
  const me = useQuery({ queryKey: ['me'], queryFn: api.auth.me });
  const isPro =
    me.data?.subscription?.plan === 'PRO' &&
    me.data?.subscription?.status === 'ACTIVE';

  const activeRouter = routerQuery.data;
  const routerName = activeRouter?.alias || activeRouter?.identity || '';
  const health = routerHealth(activeRouter?.health ?? 'UNKNOWN');
  const healthColor = toneColor(health.tone);

  return (
    <View
      style={{
        paddingTop: insets.top,
        backgroundColor: theme.surface,
        borderBottomWidth: 1,
        borderBottomColor: theme.border,
      }}
    >
      <View
        style={{
          height: HEADER_HEIGHT,
          paddingHorizontal: space.lg,
          flexDirection: 'row',
          alignItems: 'center',
          gap: space.sm,
        }}
      >
        {back ? (
          <Pressable
            accessibilityLabel="Retour"
            onPress={() => router.back()}
            hitSlop={8}
            style={{
              width: 34,
              height: 34,
              borderRadius: radius.md,
              borderWidth: 1,
              borderColor: theme.border,
              backgroundColor: theme.surfaceAlt,
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <Ionicons name="chevron-back" size={icon.md} color={theme.text} />
          </Pressable>
        ) : (
          <View
            style={{
              width: 34,
              height: 34,
              borderRadius: radius.md,
              backgroundColor: theme.primary,
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <Ionicons name="wifi" size={icon.md} color={theme.primaryText} />
          </View>
        )}

        <View style={{ flex: 1 }}>
          <Text
            numberOfLines={1}
            style={{ color: theme.text, fontWeight: '800', fontSize: type.bodyLg }}
          >
            {title}
          </Text>
          {routerName ? (
            <View
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                gap: space.xs + 1,
                marginTop: 1,
              }}
            >
              <View
                style={{
                  width: 6,
                  height: 6,
                  borderRadius: 3,
                  backgroundColor: healthColor,
                }}
              />
              <Text
                numberOfLines={1}
                style={{
                  color: healthColor,
                  fontSize: type.micro,
                  fontWeight: '700',
                  letterSpacing: 0.3,
                }}
              >
                {routerName}
              </Text>
            </View>
          ) : null}
        </View>

        <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm }}>
          <NotificationBell />
          {!isPro ? (
            <Pressable
              accessibilityLabel="Passer à PRO"
              onPress={() => router.push('/pro')}
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                gap: space.xs,
                paddingHorizontal: space.sm + 2,
                paddingVertical: space.xs + 2,
                borderRadius: radius.sm,
                backgroundColor: theme.gold,
              }}
            >
              <Ionicons name="diamond" size={type.caption} color={theme.goldText} />
              <Text
                style={{
                  color: theme.goldText,
                  fontWeight: '800',
                  fontSize: type.micro,
                }}
              >
                PRO
              </Text>
            </Pressable>
          ) : null}
          <Pressable
            accessibilityLabel="Compte"
            onPress={() => router.push('/(tabs)/account')}
            hitSlop={5}
            style={{
              width: 34,
              height: 34,
              borderRadius: radius.md,
              borderWidth: 1,
              borderColor: theme.border,
              backgroundColor: theme.surfaceAlt,
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <Text
              style={{ color: theme.text, fontWeight: '700', fontSize: type.body }}
            >
              {(me.data?.tenant?.name ?? 'M').trim().charAt(0).toUpperCase()}
            </Text>
          </Pressable>
        </View>
      </View>
    </View>
  );
}
