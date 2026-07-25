import { useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api, extractErrorMessage, type Plan } from '@/src/lib/api';
import {
  Badge,
  Banner,
  Button,
  Card,
  Empty,
  Field,
  Label,
  Row,
  Subtitle,
  Title,
  theme,
} from '@/src/components/ui';
import { BottomNav } from '@/src/components/BottomNav';

function fmtDuration(min: number): string {
  if (min % 1440 === 0) return `${min / 1440}j`;
  if (min % 60 === 0) return `${min / 60}h`;
  return `${min}min`;
}

function speedLabel(p: Plan): string {
  const up = p.uploadKbps ? Math.round(p.uploadKbps / 1000) : null;
  const down = p.downloadKbps ? Math.round(p.downloadKbps / 1000) : null;
  if (up && down) return `${up}M/${down}M`;
  if (down) return `${down}M`;
  return 'Illimité';
}

function Chip({
  icon,
  color,
  label,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  color: string;
  label: string;
}) {
  return (
    <View
      style={{
        flex: 1,
        backgroundColor: theme.surfaceAlt,
        borderRadius: 12,
        borderWidth: 1,
        borderColor: theme.border,
        paddingVertical: 8,
        paddingHorizontal: 8,
        flexDirection: 'row',
        alignItems: 'center',
        gap: 5,
      }}
    >
      <Ionicons name={icon} size={13} color={color} />
      <Text style={{ color: theme.textMuted, fontSize: 11 }} numberOfLines={1}>
        {label}
      </Text>
    </View>
  );
}

export default function PlansScreen() {
  const { routerId } = useLocalSearchParams<{ routerId: string }>();
  const qc = useQueryClient();
  const query = useQuery({
    queryKey: ['plans', routerId],
    queryFn: () => api.plans.list(routerId),
    enabled: Boolean(routerId),
  });

  const [showForm, setShowForm] = useState(false);
  const [menuFor, setMenuFor] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [duration, setDuration] = useState('');
  const [price, setPrice] = useState('');
  const [down, setDown] = useState('');
  const [up, setUp] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function create() {
    setError(null);
    const durationMinutes = Number.parseInt(duration, 10);
    const priceXof = Number.parseInt(price, 10);
    if (!name.trim() || !durationMinutes || Number.isNaN(priceXof)) {
      setError('Nom, durée (min) et prix sont requis.');
      return;
    }
    setBusy(true);
    try {
      await api.plans.create(routerId, {
        name: name.trim(),
        durationMinutes,
        priceXof,
        downloadKbps: down ? Number.parseInt(down, 10) : null,
        uploadKbps: up ? Number.parseInt(up, 10) : null,
      });
      setName('');
      setDuration('');
      setPrice('');
      setDown('');
      setUp('');
      setShowForm(false);
      await qc.invalidateQueries({ queryKey: ['plans', routerId] });
    } catch (e) {
      setError(extractErrorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  async function remove(id: string) {
    try {
      await api.plans.remove(routerId, id);
      await qc.invalidateQueries({ queryKey: ['plans', routerId] });
    } catch (e) {
      setError(extractErrorMessage(e));
    }
  }

  return (
    <View style={{ flex: 1, backgroundColor: theme.bg }}>
      <ScrollView contentContainerStyle={{ gap: 16, padding: 16, paddingBottom: 100 }}>
        <Row>
          <View style={{ flex: 1, paddingRight: 12 }}>
            <Title>Forfaits & Plans WiFi</Title>
            <Subtitle>Définissez les tarifs, vitesses et durées</Subtitle>
          </View>
          <Pressable
            accessibilityLabel="Nouveau forfait"
            onPress={() => setShowForm((v) => !v)}
            style={{
              width: 44,
              height: 44,
              borderRadius: 14,
              backgroundColor: theme.primary,
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <Ionicons
              name={showForm ? 'close' : 'add'}
              size={24}
              color={theme.primaryText}
            />
          </Pressable>
        </Row>

        {error ? <Banner tone="danger">{error}</Banner> : null}

        {showForm ? (
          <Card>
            <Label>Nouveau forfait</Label>
            <Field label="Nom" value={name} onChangeText={setName} placeholder="Ex. 1 Heure" />
            <Field
              label="Durée (minutes)"
              value={duration}
              onChangeText={setDuration}
              keyboardType="number-pad"
              placeholder="60"
            />
            <Field
              label="Prix (FCFA)"
              value={price}
              onChangeText={setPrice}
              keyboardType="number-pad"
              placeholder="200"
            />
            <Row style={{ gap: 12 }}>
              <View style={{ flex: 1 }}>
                <Field
                  label="Débit ↓ (kbps)"
                  value={down}
                  onChangeText={setDown}
                  keyboardType="number-pad"
                  placeholder="optionnel"
                />
              </View>
              <View style={{ flex: 1 }}>
                <Field
                  label="Débit ↑ (kbps)"
                  value={up}
                  onChangeText={setUp}
                  keyboardType="number-pad"
                  placeholder="optionnel"
                />
              </View>
            </Row>
            <Button title="Créer le forfait" onPress={create} loading={busy} />
          </Card>
        ) : null}

        {query.isLoading ? (
          <Subtitle>Chargement…</Subtitle>
        ) : !query.data?.length ? (
          <Empty text="Aucun forfait. Appuyez sur + pour en créer un." />
        ) : (
          <View style={{ gap: 12 }}>
            {query.data.map((p: Plan) => (
              <Card key={p.id} style={{ gap: 12 }}>
                <Row style={{ alignItems: 'flex-start' }}>
                  <Row style={{ gap: 12, flex: 1, justifyContent: 'flex-start' }}>
                    <View
                      style={{
                        width: 46,
                        height: 46,
                        borderRadius: 14,
                        backgroundColor: theme.primary + '22',
                        borderWidth: 1,
                        borderColor: theme.primary + '55',
                        alignItems: 'center',
                        justifyContent: 'center',
                      }}
                    >
                      <Ionicons name="ticket-outline" size={22} color={theme.primary} />
                    </View>
                    <View style={{ flex: 1 }}>
                      <Row style={{ justifyContent: 'flex-start', gap: 8 }}>
                        <Text style={{ color: theme.text, fontWeight: '700', fontSize: 15 }}>
                          {p.name}
                        </Text>
                        <Badge
                          label={`${p.priceXof.toLocaleString('fr-FR')} FCFA`}
                          tone="success"
                        />
                      </Row>
                      <Row style={{ justifyContent: 'flex-start', gap: 6, marginTop: 3 }}>
                        <Ionicons name="time-outline" size={13} color={theme.secondary} />
                        <Text style={{ color: theme.textMuted, fontSize: 12 }}>
                          {fmtDuration(p.durationMinutes)}
                        </Text>
                        <Text style={{ color: theme.textMuted, fontSize: 12 }}>•</Text>
                        <Text style={{ color: theme.warning, fontSize: 12, fontWeight: '500' }}>
                          Temps écoulé
                        </Text>
                      </Row>
                      {p.description ? (
                        <Text
                          style={{ color: theme.textMuted, fontSize: 11.5, marginTop: 2 }}
                          numberOfLines={1}
                        >
                          {p.description}
                        </Text>
                      ) : null}
                    </View>
                  </Row>
                  <Pressable
                    accessibilityLabel="Options du forfait"
                    onPress={() => setMenuFor(menuFor === p.id ? null : p.id)}
                    hitSlop={8}
                    style={{ padding: 4 }}
                  >
                    <Ionicons name="ellipsis-vertical" size={18} color={theme.textMuted} />
                  </Pressable>
                </Row>

                {menuFor === p.id ? (
                  <Pressable
                    onPress={() => {
                      setMenuFor(null);
                      remove(p.id);
                    }}
                    style={{
                      flexDirection: 'row',
                      alignItems: 'center',
                      gap: 8,
                      paddingVertical: 10,
                      paddingHorizontal: 12,
                      borderRadius: 12,
                      backgroundColor: theme.danger + '18',
                      borderWidth: 1,
                      borderColor: theme.danger + '40',
                    }}
                  >
                    <Ionicons name="trash-outline" size={16} color={theme.danger} />
                    <Text style={{ color: theme.danger, fontWeight: '600', fontSize: 13 }}>
                      Supprimer ce forfait
                    </Text>
                  </Pressable>
                ) : null}

                <Row
                  style={{
                    gap: 8,
                    paddingTop: 12,
                    borderTopWidth: 1,
                    borderTopColor: theme.border,
                  }}
                >
                  <Chip icon="flash-outline" color={theme.gold} label={speedLabel(p)} />
                  <Chip icon="people-outline" color={theme.secondary} label="1 user" />
                  <Chip
                    icon="layers-outline"
                    color={theme.primary}
                    label={p.dataLimitMb ? `${p.dataLimitMb} Mo` : 'Illimité'}
                  />
                </Row>
              </Card>
            ))}
          </View>
        )}
      </ScrollView>
      <BottomNav active="plans" />
    </View>
  );
}
