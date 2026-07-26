import { useState } from 'react';
import { View, Text, Pressable } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/src/lib/api';
import { useActiveRouter } from '@/src/providers/active-router-provider';
import { Banner, theme } from './ui';

// Persistent header shown on every screen while a router is selected —
// mirrors the reference's header (screen name + router identity badge +
// mode pill + support + PRO + avatar). The reference also shows the
// router's model/IP in a mono subline; we deliberately drop that (no
// IP/technical details in client-facing UI — see feedback_hide_technical_details).
export function RouterTopBar({ title }: { title: string }) {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { activeRouterId } = useActiveRouter();
  const [supportNotice, setSupportNotice] = useState(false);

  const routerQuery = useQuery({
    queryKey: ['router', activeRouterId],
    queryFn: () => api.routers.get(activeRouterId as string),
    enabled: Boolean(activeRouterId),
  });
  const me = useQuery({ queryKey: ['me'], queryFn: api.auth.me });
  const isPro =
    me.data?.subscription?.plan === 'PRO' &&
    me.data?.subscription?.status === 'ACTIVE';

  const routerName = routerQuery.data?.alias || routerQuery.data?.identity || '';

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
          minHeight: 58,
          paddingHorizontal: 16,
          paddingVertical: 8,
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'space-between',
        }}
      >
        <View
          style={{ flexDirection: 'row', alignItems: 'center', gap: 10, flex: 1 }}
        >
          <View
            style={{
              width: 34,
              height: 34,
              borderRadius: 11,
              backgroundColor: theme.primary,
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <Ionicons name="wifi" size={18} color={theme.primaryText} />
          </View>
          <View style={{ flex: 1 }}>
            <Text
              numberOfLines={1}
              style={{ color: theme.text, fontWeight: '800', fontSize: 15 }}
            >
              {title}
            </Text>
            {routerName ? (
              <View
                style={{ flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 1 }}
              >
                <View
                  style={{
                    width: 6,
                    height: 6,
                    borderRadius: 3,
                    backgroundColor: theme.success,
                  }}
                />
                <Text
                  numberOfLines={1}
                  style={{
                    color: theme.success,
                    fontSize: 10,
                    fontWeight: '700',
                    letterSpacing: 0.3,
                    textTransform: 'uppercase',
                  }}
                >
                  {routerName}
                </Text>
              </View>
            ) : null}
          </View>
        </View>

        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
          <View
            style={{
              paddingHorizontal: 8,
              paddingVertical: 5,
              borderRadius: 8,
              backgroundColor: theme.secondary + '18',
              borderWidth: 1,
              borderColor: theme.secondary + '40',
            }}
          >
            <Text style={{ color: theme.secondary, fontSize: 10, fontWeight: '700' }}>
              Routeur
            </Text>
          </View>
          <Pressable
            accessibilityLabel="Support"
            onPress={() => setSupportNotice(true)}
            style={{
              width: 30,
              height: 30,
              borderRadius: 10,
              borderWidth: 1,
              borderColor: theme.border,
              backgroundColor: theme.surfaceAlt,
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <Ionicons name="headset-outline" size={15} color={theme.textMuted} />
          </Pressable>
          {!isPro ? (
            <Pressable
              accessibilityLabel="Passer à PRO"
              onPress={() => router.push('/pro')}
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                gap: 3,
                paddingHorizontal: 8,
                paddingVertical: 6,
                borderRadius: 9,
                backgroundColor: theme.gold,
              }}
            >
              <Ionicons name="diamond" size={11} color={theme.goldText} />
              <Text style={{ color: theme.goldText, fontWeight: '800', fontSize: 10 }}>
                PRO
              </Text>
            </Pressable>
          ) : null}
          <Pressable
            accessibilityLabel="Compte"
            onPress={() => router.push('/(tabs)/account')}
            style={{
              width: 30,
              height: 30,
              borderRadius: 10,
              borderWidth: 1,
              borderColor: theme.border,
              backgroundColor: theme.surfaceAlt,
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <Text style={{ color: theme.text, fontWeight: '700', fontSize: 12 }}>
              {(me.data?.tenant.name ?? 'M').trim().charAt(0).toUpperCase()}
            </Text>
          </Pressable>
        </View>
      </View>
      {supportNotice ? (
        <View style={{ paddingHorizontal: 16, paddingBottom: 10 }}>
          <Banner tone="warning">Support — bientôt disponible.</Banner>
        </View>
      ) : null}
    </View>
  );
}
