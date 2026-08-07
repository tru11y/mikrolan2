import { useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  api,
  extractErrorMessage,
  type IpBinding,
  type IpBindingType,
  type LiveSession,
} from '@/src/lib/api';
import {
  listIpBindingsLan,
  addIpBindingLan,
  updateIpBindingLan,
  removeIpBindingLan,
  listActiveLan,
} from '@/src/services/mikrotik-lan/hotspotLan';
import { getLocalCredentials } from '@/src/lib/router-credentials';
import {
  Banner,
  Button,
  Card,
  Empty,
  Field,
  Label,
  Mono,
  Row,
  SkeletonCard,
  space,
  Subtitle,
  theme,
  Title,
} from '@/src/components/ui';
import { BottomNav, useBottomNavHeight } from '@/src/components/BottomNav';
import { AppHeader } from '@/src/components/AppHeader';

const MAC_RE = /^([0-9A-Fa-f]{2}:){5}[0-9A-Fa-f]{2}$/;
const IP_RE = /^(\d{1,3}\.){3}\d{1,3}$/;

const TYPE_META: Record<IpBindingType, { color: string; label: string }> = {
  bypassed: { color: theme.success, label: 'BYPASSED' },
  blocked: { color: theme.danger, label: 'BLOCKED' },
  regular: { color: theme.warning, label: 'REGULAR' },
};

function TypeDot({ type }: { type: IpBindingType }) {
  return (
    <View
      style={{
        width: 10,
        height: 10,
        borderRadius: 5,
        backgroundColor: TYPE_META[type].color,
      }}
    />
  );
}

export default function IpBindingsScreen() {
  const navHeight = useBottomNavHeight();
  const { routerId } = useLocalSearchParams<{ routerId: string }>();
  const qc = useQueryClient();

  const bindingsQuery = useQuery({
    queryKey: ['ip-bindings', routerId],
    queryFn: async (): Promise<IpBinding[]> => {
      const creds = await getLocalCredentials(routerId);
      if (creds) return listIpBindingsLan(creds);
      return api.routers.listIpBindings(routerId);
    },
    enabled: Boolean(routerId),
    placeholderData: keepPreviousData,
  });

  const [formOpen, setFormOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [type, setType] = useState<IpBindingType>('bypassed');
  const [mac, setMac] = useState('');
  const [ip, setIp] = useState('');
  const [comment, setComment] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [scanOpen, setScanOpen] = useState(false);
  const sessionsQuery = useQuery({
    queryKey: ['sessions', routerId],
    queryFn: async (): Promise<LiveSession[]> => {
      const creds = await getLocalCredentials(routerId);
      if (creds) return listActiveLan(creds);
      return api.routers.listSessions(routerId);
    },
    enabled: Boolean(routerId) && scanOpen,
  });

  function resetForm() {
    setEditingId(null);
    setType('bypassed');
    setMac('');
    setIp('');
    setComment('');
    setError(null);
  }

  function openEdit(b: IpBinding) {
    setEditingId(b.id);
    setType(b.type);
    setMac(b.macAddress);
    setIp(b.ipAddress ?? '');
    setComment(b.comment ?? '');
    setError(null);
    setFormOpen(true);
  }

  function pickSession(s: LiveSession) {
    if (s.macAddress) setMac(s.macAddress);
    if (s.ipAddress) setIp(s.ipAddress);
    setComment(s.user || '');
    setScanOpen(false);
  }

  async function save() {
    setError(null);
    if (!MAC_RE.test(mac.trim())) {
      setError('Adresse MAC invalide (format 00:11:22:33:44:55).');
      return;
    }
    if (ip.trim() && !IP_RE.test(ip.trim())) {
      setError('Adresse IP invalide.');
      return;
    }
    setBusy(true);
    try {
      const payload = {
        macAddress: mac.trim(),
        ipAddress: ip.trim() || undefined,
        type,
        comment: comment.trim() || undefined,
      };
      const creds = await getLocalCredentials(routerId);
      if (editingId) {
        if (creds) {
          await updateIpBindingLan(creds, editingId, payload);
        } else {
          await api.routers.updateIpBinding(routerId, editingId, payload);
        }
      } else if (creds) {
        await addIpBindingLan(creds, payload);
      } else {
        await api.routers.addIpBinding(routerId, payload);
      }
      resetForm();
      setFormOpen(false);
      await qc.invalidateQueries({ queryKey: ['ip-bindings', routerId] });
    } catch (e) {
      setError(extractErrorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  async function remove(bindingId: string) {
    try {
      const creds = await getLocalCredentials(routerId);
      if (creds) {
        await removeIpBindingLan(creds, bindingId);
      } else {
        await api.routers.removeIpBinding(routerId, bindingId);
      }
      await qc.invalidateQueries({ queryKey: ['ip-bindings', routerId] });
    } catch (e) {
      setError(extractErrorMessage(e));
    }
  }

  return (
    <View style={{ flex: 1, backgroundColor: theme.bg }}>
      <AppHeader title="Appareils autorisés" back />
      <ScrollView
        contentContainerStyle={{ gap: space.lg, padding: space.lg, paddingBottom: navHeight }}
      >
        <Row style={{ alignItems: 'flex-start' }}>
          <View style={{ flex: 1, paddingRight: 12 }}>
                        <Subtitle>
              Autoriser ou bloquer des appareils spécifiques sur RouterOS
            </Subtitle>
          </View>
          <Pressable
            accessibilityLabel="Autoriser un appareil"
            onPress={() => {
              resetForm();
              setFormOpen(true);
            }}
            style={{
              width: 40,
              height: 40,
              borderRadius: 12,
              backgroundColor: theme.primary,
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <Ionicons name="add" size={22} color={theme.primaryText} />
          </Pressable>
        </Row>

        {error ? <Banner tone="danger">{error}</Banner> : null}

        {bindingsQuery.isLoading ? (
          <View style={{ gap: 12 }}>
            <SkeletonCard />
            <SkeletonCard />
          </View>
        ) : !bindingsQuery.data?.length ? (
          <Empty text="Aucun IP binding pour ce routeur." />
        ) : (
          <View style={{ gap: 12 }}>
            {bindingsQuery.data.map((b) => (
              <Card key={b.id} style={{ gap: 10 }}>
                <Row>
                  <Row style={{ gap: 8, justifyContent: 'flex-start', flex: 1 }}>
                    <TypeDot type={b.type} />
                    <Text
                      style={{ color: theme.text, fontWeight: '700', fontSize: 14 }}
                      numberOfLines={1}
                    >
                      {b.comment || 'Sans commentaire'}
                    </Text>
                  </Row>
                  <View
                    style={{
                      borderWidth: 1,
                      borderColor: TYPE_META[b.type].color + '55',
                      backgroundColor: TYPE_META[b.type].color + '18',
                      borderRadius: 999,
                      paddingHorizontal: 10,
                      paddingVertical: 3,
                    }}
                  >
                    <Text
                      style={{
                        color: TYPE_META[b.type].color,
                        fontSize: 10,
                        fontWeight: '700',
                      }}
                    >
                      {TYPE_META[b.type].label}
                    </Text>
                  </View>
                </Row>

                <View
                  style={{
                    backgroundColor: theme.surfaceAlt,
                    borderWidth: 1,
                    borderColor: theme.border,
                    borderRadius: 12,
                    padding: 10,
                    gap: 3,
                  }}
                >
                  <Mono style={{ color: theme.text, fontSize: 13 }}>
                    MAC: <Mono style={{ color: theme.secondary }}>{b.macAddress}</Mono>
                  </Mono>
                  {b.ipAddress ? (
                    <Mono style={{ color: theme.textMuted, fontSize: 12 }}>
                      IP Fixe: <Mono style={{ color: theme.text }}>{b.ipAddress}</Mono>
                    </Mono>
                  ) : null}
                  {b.server ? (
                    <Text style={{ color: theme.textMuted, fontSize: 11 }}>
                      Serveur: <Text style={{ color: theme.text }}>{b.server}</Text>
                    </Text>
                  ) : null}
                </View>

                <Row style={{ justifyContent: 'flex-end', gap: 8 }}>
                  <Pressable
                    accessibilityLabel="Modifier"
                    onPress={() => openEdit(b)}
                    hitSlop={8}
                    style={{
                      padding: 6,
                      borderRadius: 8,
                      backgroundColor: theme.primary + '18',
                    }}
                  >
                    <Ionicons name="create-outline" size={16} color={theme.primary} />
                  </Pressable>
                  <Pressable
                    accessibilityLabel="Supprimer"
                    onPress={() => remove(b.id)}
                    hitSlop={8}
                    style={{
                      padding: 6,
                      borderRadius: 8,
                      backgroundColor: theme.danger + '18',
                    }}
                  >
                    <Ionicons name="trash-outline" size={16} color={theme.danger} />
                  </Pressable>
                </Row>
              </Card>
            ))}
          </View>
        )}
      </ScrollView>

      {/* Modal: Nouveau IP Binding */}
      {formOpen ? (
        <View
          style={{
            position: 'absolute',
            inset: 0,
            backgroundColor: '#000000cc',
            alignItems: 'center',
            justifyContent: 'center',
            padding: 16,
          }}
        >
          <View
            style={{
              width: '100%',
              maxWidth: 400,
              backgroundColor: theme.surface,
              borderWidth: 1,
              borderColor: theme.border,
              borderRadius: 16,
              padding: 20,
              gap: 14,
            }}
          >
            <Row>
              <Text style={{ color: theme.text, fontWeight: '700', fontSize: 15 }}>
                {editingId ? 'Modifier IP Binding' : 'Nouveau IP Binding'}
              </Text>
              <Pressable onPress={() => setFormOpen(false)} hitSlop={8}>
                <Ionicons name="close" size={20} color={theme.textMuted} />
              </Pressable>
            </Row>

            <View>
              <Label>Type de liaison</Label>
              <Row style={{ gap: 8 }}>
                {(['bypassed', 'blocked', 'regular'] as IpBindingType[]).map((t) => {
                  const active = t === type;
                  return (
                    <Pressable
                      key={t}
                      onPress={() => setType(t)}
                      style={{
                        flex: 1,
                        paddingVertical: 10,
                        borderRadius: 10,
                        alignItems: 'center',
                        borderWidth: 1,
                        borderColor: active ? TYPE_META[t].color : theme.border,
                        backgroundColor: active
                          ? TYPE_META[t].color + '18'
                          : theme.surfaceAlt,
                      }}
                    >
                      <Text
                        style={{
                          color: active ? TYPE_META[t].color : theme.textMuted,
                          fontSize: 11,
                          fontWeight: '700',
                        }}
                      >
                        {TYPE_META[t].label}
                      </Text>
                    </Pressable>
                  );
                })}
              </Row>
            </View>

            <View>
              <Row>
                <Label>Adresse MAC</Label>
              </Row>
              <Row style={{ gap: 8 }}>
                <View style={{ flex: 1 }}>
                  <Field
                    value={mac}
                    onChangeText={setMac}
                    placeholder="00:11:22:33:44:55"
                    autoCapitalize="characters"
                  />
                </View>
                <Pressable
                  accessibilityLabel="Choisir un appareil connecté"
                  onPress={() => setScanOpen(true)}
                  style={{
                    width: 44,
                    height: 44,
                    borderRadius: 12,
                    backgroundColor: theme.primary,
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  <Ionicons name="search" size={18} color={theme.primaryText} />
                </Pressable>
              </Row>
            </View>

            <Field
              label="Adresse IP (optionnelle)"
              value={ip}
              onChangeText={setIp}
              placeholder="10.10.10.150"
              autoCapitalize="none"
            />

            <Field
              label="Commentaire / Description"
              value={comment}
              onChangeText={setComment}
              placeholder="ex: Imprimante Caisse"
            />

            <Row style={{ gap: 8 }}>
              <View style={{ flex: 1 }}>
                <Button
                  title="Annuler"
                  variant="ghost"
                  onPress={() => setFormOpen(false)}
                />
              </View>
              <View style={{ flex: 1 }}>
                <Button title={editingId ? 'Modifier' : 'Sauvegarder'} onPress={save} loading={busy} />
              </View>
            </Row>
          </View>
        </View>
      ) : null}

      {/* Bottom sheet: appareils connectés (sessions live réelles) */}
      {scanOpen ? (
        <View
          style={{
            position: 'absolute',
            inset: 0,
            backgroundColor: '#000000cc',
            justifyContent: 'flex-end',
          }}
        >
          <View
            style={{
              backgroundColor: theme.surface,
              borderTopWidth: 1,
              borderTopColor: theme.border,
              borderTopLeftRadius: 24,
              borderTopRightRadius: 24,
              padding: 20,
              gap: 14,
              maxHeight: '70%',
            }}
          >
            <View
              style={{
                width: 48,
                height: 5,
                borderRadius: 3,
                backgroundColor: theme.border,
                alignSelf: 'center',
              }}
            />
            <Row>
              <Row style={{ gap: 8, justifyContent: 'flex-start' }}>
                <Ionicons name="wifi" size={18} color={theme.secondary} />
                <Text style={{ color: theme.text, fontWeight: '700', fontSize: 15 }}>
                  Appareils connectés au hotspot
                </Text>
              </Row>
              <Pressable onPress={() => setScanOpen(false)} hitSlop={8}>
                <Text style={{ color: theme.textMuted, fontSize: 12 }}>Fermer</Text>
              </Pressable>
            </Row>

            {sessionsQuery.isLoading ? (
              <Subtitle>Analyse des sessions actives…</Subtitle>
            ) : !sessionsQuery.data?.length ? (
              <Empty text="Aucun appareil connecté actuellement." />
            ) : (
              <ScrollView style={{ maxHeight: 320 }}>
                <View style={{ gap: 8 }}>
                  {sessionsQuery.data.map((s) => (
                    <Pressable key={s.id} onPress={() => pickSession(s)}>
                      <Card>
                        <Row>
                          <View style={{ flex: 1 }}>
                            <Text
                              style={{ color: theme.text, fontWeight: '700', fontSize: 13 }}
                            >
                              {s.user || 'Appareil'}
                            </Text>
                            <Mono style={{ color: theme.textMuted, fontSize: 11 }}>
                              {s.macAddress ?? '—'} · {s.ipAddress ?? '—'}
                            </Mono>
                          </View>
                          <Text
                            style={{ color: theme.primary, fontSize: 12, fontWeight: '700' }}
                          >
                            Sélectionner →
                          </Text>
                        </Row>
                      </Card>
                    </Pressable>
                  ))}
                </View>
              </ScrollView>
            )}
          </View>
        </View>
      ) : null}

      <BottomNav active="index" />
    </View>
  );
}
