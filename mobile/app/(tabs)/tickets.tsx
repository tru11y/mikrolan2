import { ScrollView, View, Text, Pressable } from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/src/lib/api';
import {
  Badge,
  Button,
  Card,
  Mono,
  Row,
  Subtitle,
  theme,
  Title,
} from '@/src/components/ui';
import { BottomNav } from '@/src/components/BottomNav';

export default function TicketsScreen() {
  const router = useRouter();
  const routers = useQuery({ queryKey: ['routers'], queryFn: api.routers.list });
  const list = routers.data ?? [];

  return (
    <View style={{ flex: 1, backgroundColor: theme.bg }}>
    <ScrollView
      style={{ flex: 1, backgroundColor: theme.bg }}
      contentContainerStyle={{ padding: 16, gap: 16, paddingBottom: 100 }}
    >
      <View>
        <Title>Créer des tickets</Title>
        <Subtitle>Choisissez un routeur pour générer des codes WiFi</Subtitle>
      </View>

      {list.length === 0 ? (
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
            <Pressable
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
                  <Badge
                    label={r.health === 'ONLINE' ? 'EN LIGNE' : 'HORS LIGNE'}
                    tone={r.health === 'ONLINE' ? 'secondary' : 'danger'}
                  />
                </Row>
              </Card>
            </Pressable>
          ))}
        </View>
      )}
    </ScrollView>
    <BottomNav />
    </View>
  );
}
