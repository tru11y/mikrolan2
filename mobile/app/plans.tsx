import { useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  api,
  extractErrorMessage,
  type Plan,
  type PlanCodeFormat,
  type PlanExpiration,
} from '@/src/lib/api';
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
import { RouterTopBar } from '@/src/components/RouterTopBar';

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
  const [editingId, setEditingId] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [price, setPrice] = useState('');
  const [maxUsers, setMaxUsers] = useState('1');
  const [downMbps, setDownMbps] = useState('');
  const [upMbps, setUpMbps] = useState('');
  const [expirationMode, setExpirationMode] = useState<PlanExpiration>('ELAPSED');
  const [days, setDays] = useState('0');
  const [hours, setHours] = useState('1');
  const [minutes, setMinutes] = useState('0');
  const [codePrefix, setCodePrefix] = useState('');
  const [codeLength, setCodeLength] = useState('8');
  const [codeFormat, setCodeFormat] = useState<PlanCodeFormat>('ALPHANUMERIC');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function resetForm() {
    setEditingId(null);
    setName('');
    setPrice('');
    setMaxUsers('1');
    setDownMbps('');
    setUpMbps('');
    setExpirationMode('ELAPSED');
    setDays('0');
    setHours('1');
    setMinutes('0');
    setCodePrefix('');
    setCodeLength('8');
    setCodeFormat('ALPHANUMERIC');
  }

  function startEdit(p: Plan) {
    setMenuFor(null);
    setError(null);
    setEditingId(p.id);
    setName(p.name);
    setPrice(String(p.priceXof));
    setMaxUsers(String(p.sharedUsers));
    setUpMbps(p.uploadKbps ? String(Math.round(p.uploadKbps / 1000)) : '');
    setDownMbps(p.downloadKbps ? String(Math.round(p.downloadKbps / 1000)) : '');
    setExpirationMode(p.expirationMode);
    setDays(String(Math.floor(p.durationMinutes / 1440)));
    setHours(String(Math.floor((p.durationMinutes % 1440) / 60)));
    setMinutes(String(p.durationMinutes % 60));
    setCodePrefix(p.codePrefix ?? '');
    setCodeLength(String(p.codeLength));
    setCodeFormat(p.codeFormat);
    setShowForm(true);
  }

  async function submit() {
    setError(null);
    const durationMinutes =
      (Number.parseInt(days, 10) || 0) * 1440 +
      (Number.parseInt(hours, 10) || 0) * 60 +
      (Number.parseInt(minutes, 10) || 0);
    const priceXof = Number.parseInt(price, 10);
    if (!name.trim() || !durationMinutes || Number.isNaN(priceXof)) {
      setError('Nom, durée et prix sont requis.');
      return;
    }
    setBusy(true);
    try {
      const payload = {
        name: name.trim(),
        durationMinutes,
        priceXof,
        downloadKbps: downMbps ? Number.parseInt(downMbps, 10) * 1000 : null,
        uploadKbps: upMbps ? Number.parseInt(upMbps, 10) * 1000 : null,
        sharedUsers: Number.parseInt(maxUsers, 10) || 1,
        expirationMode,
        codePrefix: codePrefix.trim() || null,
        codeLength: Math.min(12, Math.max(4, Number.parseInt(codeLength, 10) || 8)),
        codeFormat,
      };
      if (editingId) {
        await api.plans.update(routerId, editingId, payload);
      } else {
        await api.plans.create(routerId, payload);
      }
      resetForm();
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
      <RouterTopBar title="Forfaits" />
      <ScrollView contentContainerStyle={{ gap: 16, padding: 16, paddingBottom: 100 }}>
        <Row>
          <View style={{ flex: 1, paddingRight: 12 }}>
            <Title>Forfaits & Plans WiFi</Title>
            <Subtitle>Définissez les tarifs, vitesses et durées</Subtitle>
          </View>
          <Pressable
            accessibilityLabel="Nouveau forfait"
            onPress={() => {
              if (showForm) {
                setShowForm(false);
                resetForm();
              } else {
                resetForm();
                setShowForm(true);
              }
            }}
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
            <Label>{editingId ? 'Modifier le forfait' : 'Nouveau forfait'}</Label>
            <Row style={{ gap: 12 }}>
              <View style={{ flex: 2 }}>
                <Field label="Nom" value={name} onChangeText={setName} placeholder="Ex. 1 Heure" />
              </View>
              <View style={{ flex: 1 }}>
                <Field
                  label="Prix (FCFA)"
                  value={price}
                  onChangeText={setPrice}
                  keyboardType="number-pad"
                  placeholder="200"
                />
              </View>
            </Row>

            <Row style={{ gap: 12 }}>
              <View style={{ flex: 1 }}>
                <Field
                  label="Users max"
                  value={maxUsers}
                  onChangeText={setMaxUsers}
                  keyboardType="number-pad"
                  placeholder="1"
                />
              </View>
              <View style={{ flex: 1 }}>
                <Field
                  label="Upload (Mb/s)"
                  value={upMbps}
                  onChangeText={setUpMbps}
                  keyboardType="number-pad"
                  placeholder="1"
                />
              </View>
              <View style={{ flex: 1 }}>
                <Field
                  label="Download (Mb/s)"
                  value={downMbps}
                  onChangeText={setDownMbps}
                  keyboardType="number-pad"
                  placeholder="5"
                />
              </View>
            </Row>

            <View>
              <Label>Type de décompte temps</Label>
              <Row style={{ gap: 8 }}>
                <Pressable
                  onPress={() => setExpirationMode('ELAPSED')}
                  style={{
                    flex: 1,
                    borderWidth: 1,
                    borderColor:
                      expirationMode === 'ELAPSED' ? theme.secondary : theme.border,
                    backgroundColor:
                      expirationMode === 'ELAPSED' ? theme.secondary + '18' : theme.surfaceAlt,
                    borderRadius: 12,
                    padding: 10,
                  }}
                >
                  <Text style={{ color: theme.text, fontWeight: '700', fontSize: 12 }}>
                    Temps écoulé
                  </Text>
                  <Text style={{ color: theme.textMuted, fontSize: 10, marginTop: 2 }}>
                    Le chrono tourne dès la 1ère connexion
                  </Text>
                </Pressable>
                <Pressable
                  onPress={() => setExpirationMode('RADIO_PAUSE')}
                  style={{
                    flex: 1,
                    borderWidth: 1,
                    borderColor:
                      expirationMode === 'RADIO_PAUSE' ? theme.secondary : theme.border,
                    backgroundColor:
                      expirationMode === 'RADIO_PAUSE' ? theme.secondary + '18' : theme.surfaceAlt,
                    borderRadius: 12,
                    padding: 10,
                  }}
                >
                  <Text style={{ color: theme.text, fontWeight: '700', fontSize: 12 }}>
                    Pause radio
                  </Text>
                  <Text style={{ color: theme.textMuted, fontSize: 10, marginTop: 2 }}>
                    Le décompte s'arrête à la déconnexion
                  </Text>
                </Pressable>
              </Row>
            </View>

            <View>
              <Label>Durée de validité</Label>
              <Row style={{ gap: 12 }}>
                <View style={{ flex: 1 }}>
                  <Field
                    label="Jours"
                    value={days}
                    onChangeText={setDays}
                    keyboardType="number-pad"
                  />
                </View>
                <View style={{ flex: 1 }}>
                  <Field
                    label="Heures"
                    value={hours}
                    onChangeText={setHours}
                    keyboardType="number-pad"
                  />
                </View>
                <View style={{ flex: 1 }}>
                  <Field
                    label="Minutes"
                    value={minutes}
                    onChangeText={setMinutes}
                    keyboardType="number-pad"
                  />
                </View>
              </Row>
            </View>

            <View>
              <Label>Format du code</Label>
              <Row style={{ gap: 12 }}>
                <View style={{ flex: 2 }}>
                  <Field
                    label="Préfixe"
                    value={codePrefix}
                    onChangeText={(v) => setCodePrefix(v.replace(/[^A-Za-z0-9]/g, ''))}
                    placeholder="Ex. 1h"
                    autoCapitalize="none"
                    maxLength={12}
                  />
                </View>
                <View style={{ flex: 1 }}>
                  <Field
                    label="Longueur"
                    value={codeLength}
                    onChangeText={setCodeLength}
                    keyboardType="number-pad"
                    placeholder="8"
                  />
                </View>
              </Row>
              <Row style={{ gap: 8, marginTop: 12 }}>
                <Pressable
                  onPress={() => setCodeFormat('ALPHANUMERIC')}
                  style={{
                    flex: 1,
                    borderWidth: 1,
                    borderColor:
                      codeFormat === 'ALPHANUMERIC' ? theme.secondary : theme.border,
                    backgroundColor:
                      codeFormat === 'ALPHANUMERIC' ? theme.secondary + '18' : theme.surfaceAlt,
                    borderRadius: 12,
                    padding: 10,
                  }}
                >
                  <Text style={{ color: theme.text, fontWeight: '700', fontSize: 12 }}>
                    Lettres + Chiffres
                  </Text>
                  <Text style={{ color: theme.textMuted, fontSize: 10, marginTop: 2 }}>
                    Ex. 3K7F9QXZ
                  </Text>
                </Pressable>
                <Pressable
                  onPress={() => setCodeFormat('NUMERIC')}
                  style={{
                    flex: 1,
                    borderWidth: 1,
                    borderColor: codeFormat === 'NUMERIC' ? theme.secondary : theme.border,
                    backgroundColor:
                      codeFormat === 'NUMERIC' ? theme.secondary + '18' : theme.surfaceAlt,
                    borderRadius: 12,
                    padding: 10,
                  }}
                >
                  <Text style={{ color: theme.text, fontWeight: '700', fontSize: 12 }}>
                    Chiffres uniquement
                  </Text>
                  <Text style={{ color: theme.textMuted, fontSize: 10, marginTop: 2 }}>
                    Ex. 98317204 (PIN)
                  </Text>
                </Pressable>
              </Row>
            </View>

            {editingId ? (
              <Row style={{ gap: 8 }}>
                <View style={{ flex: 1 }}>
                  <Button
                    title="Annuler"
                    variant="ghost"
                    onPress={() => {
                      setShowForm(false);
                      resetForm();
                    }}
                  />
                </View>
                <View style={{ flex: 1 }}>
                  <Button title="Mettre à jour" onPress={submit} loading={busy} />
                </View>
              </Row>
            ) : (
              <Button title="Créer le forfait" onPress={submit} loading={busy} />
            )}
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
                          {p.expirationMode === 'RADIO_PAUSE' ? 'Pause radio' : 'Temps écoulé'}
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
                  <View style={{ gap: 8 }}>
                    <Pressable
                      onPress={() => startEdit(p)}
                      style={{
                        flexDirection: 'row',
                        alignItems: 'center',
                        gap: 8,
                        paddingVertical: 10,
                        paddingHorizontal: 12,
                        borderRadius: 12,
                        backgroundColor: theme.primary + '18',
                        borderWidth: 1,
                        borderColor: theme.primary + '40',
                      }}
                    >
                      <Ionicons name="create-outline" size={16} color={theme.primary} />
                      <Text style={{ color: theme.primary, fontWeight: '600', fontSize: 13 }}>
                        Modifier ce forfait
                      </Text>
                    </Pressable>
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
                  </View>
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
                  <Chip
                    icon="people-outline"
                    color={theme.secondary}
                    label={`${p.sharedUsers} user${p.sharedUsers > 1 ? 's' : ''}`}
                  />
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
