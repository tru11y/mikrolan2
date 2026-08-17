import { ScrollView, View, Text } from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';
import { api, extractErrorMessage } from '@/src/lib/api';
import {
  Badge,
  Button,
  Card,
  ErrorState,
  Mono,
  Press,
  radius,
  routerHealth,
  Row,
  Skeleton,
  space,
  Subtitle,
  theme,
  Title,
} from '@/src/components/ui';
import { BottomNav, useBottomNavHeight } from '@/src/components/BottomNav';
import { AppHeader } from '@/src/components/AppHeader';

export default function TicketsScreen() {
  const navHeight = useBottomNavHeight();
  const router = useRouter();
  const routers = useQuery({ queryKey: ['routers'], queryFn: api.routers.list });
  const list = routers.data ?? [];

  return (
    <View style={{ flex: 1, backgroundColor: theme.bg }}>
      <AppHeader title="Créer des tickets" />
      <ScrollView
        style={{ flex: 1, backgroundColor: theme.bg }}
        contentContainerStyle={{
          padding: space.lg,
          gap: space.lg,
          paddingBottom: navHeight,
        }}
      >
      <Subtitle>Choisissez un routeur pour générer des codes WiFi</Subtitle>

      <Press
        accessibilityRole="button"
        accessibilityLabel="Vérifier un ticket"
        onPress={() => router.push('/verify-ticket')}
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          gap: space.md,
          backgroundColor: theme.surface,
          borderRadius: radius.md,
          borderWidth: 1.5,
          borderColor: theme.primary,
          padding: space.md,
        }}
      >
        <View
          style={{
            width: 40,
            height: 40,
            borderRadius: 12,
            backgroundColor: theme.primary + '22',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <Ionicons name="shield-checkmark-outline" size={20} color={theme.primary} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={{ color: theme.text, fontWeight: '700' }}>Vérifier un ticket</Text>
          <Text style={{ color: theme.textMuted, fontSize: 12 }}>
            Contrôler un code présenté par un client avant de l&apos;accepter
          </Text>
        </View>
        <Ionicons name="chevron-forward" size={18} color={theme.textMuted} />
      </Press>

      {routers.isLoading ? (
        <View style={{ gap: space.sm }}>
          <Skeleton height={64} radius={radius.md} />
          <Skeleton height={64} radius={radius.md} />
        </View>
      ) : routers.isError && !routers.data ? (
        <ErrorState
          message={extractErrorMessage(routers.error)}
          onRetry={() => routers.refetch()}
          retrying={routers.isRefetching}
        />
      ) : list.length === 0 ? (
        <Card>
          <Text style={{ color: theme.textMuted }}>
            Ajoutez d'abord un routeur pour générer des tickets.
          </Text>
          <Button
            title="Ajouter un routeur"
            onPress={() => router.push('/add-router')}
          />
        </Card>
      ) : (
        <View style={{ gap: 12 }}>
          {list.map((r) => (
            <Press
              key={r.id}
              onPress={() =>
                router.push({
                  pathname: '/generate-vouchers',
                  params: { routerId: r.id },
                })
              }
            >
              <Card>
                <Row>
                  <Row style={{ gap: 12, flex: 1, justifyContent: 'flex-start' }}>
                    <View
                      style={{
                        width: 40,
                        height: 40,
                        borderRadius: 12,
                        backgroundColor: theme.primary + '22',
                        alignItems: 'center',
                        justifyContent: 'center',
                      }}
                    >
                      <Ionicons
                        name="ticket-outline"
                        size={20}
                        color={theme.primary}
                      />
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={{ color: theme.text, fontWeight: '700' }}>
                        {r.alias || r.identity}
                      </Text>
                      <Mono style={{ color: theme.textMuted, fontSize: 12 }}>
                        {r.identity}
                      </Mono>
                    </View>
                  </Row>
                  <Row style={{ gap: 8, justifyContent: 'flex-end' }}>
                    <Badge
                      label={routerHealth(r.health).label}
                      tone={routerHealth(r.health).tone}
                    />
                    <Press
                      onPress={() =>
                        router.push({
                          pathname: '/verify-ticket',
                          params: { routerId: r.id },
                        })
                      }
                      accessibilityRole="button"
                      accessibilityLabel={`Vérifier un ticket pour ${r.alias || r.identity}`}
                      style={{
                        width: 32,
                        height: 32,
                        borderRadius: radius.sm,
                        backgroundColor: theme.surfaceAlt,
                        borderWidth: 1,
                        borderColor: theme.border,
                        alignItems: 'center',
                        justifyContent: 'center',
                      }}
                    >
                      <Ionicons
                        name="shield-checkmark-outline"
                        size={16}
                        color={theme.text}
                      />
                    </Press>
                  </Row>
                </Row>
              </Card>
            </Press>
          ))}
        </View>
      )}
      </ScrollView>
      <BottomNav active="tickets" />
    </View>
  );
}
