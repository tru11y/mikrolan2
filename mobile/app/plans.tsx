import { useMemo, useState } from 'react';
import { ScrollView, Text, View } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  api,
  type Plan,
  type PlanCodeFormat,
  type PlanExpiration,
  type UserProfile,
} from '@/src/lib/api';
import { getLocalCredentials } from '@/src/lib/router-credentials';
import {
  listUserProfilesLan,
  type RouterProfile,
} from '@/src/services/mikrotik-lan/hotspotLan';
import { describeError, type FieldErrors } from '@/src/lib/errors';
import {
  Badge,
  Button,
  Card,
  Empty,
  ErrorState,
  FadeIn,
  Field,
  FieldError,
  Label,
  NumberField,
  Press,
  Row,
  SegmentedOption,
  SkeletonCard,
  Subtitle,
  Title,
  theme,
  useToast,
} from '@/src/components/ui';
import { BottomNav } from '@/src/components/BottomNav';
import { AppHeader } from '@/src/components/AppHeader';

/**
 * Bornes du code imprimé sur le ticket.
 *
 * En dessous de 7 caractères un code se devine par force brute depuis le
 * portail captif ; au-delà de 12 le client se trompe en le recopiant. Le
 * serveur accepte encore 4 (schéma historique) — c'est l'app qui refuse.
 */
const CODE_LENGTH_MIN = 7;
const CODE_LENGTH_MAX = 12;

function fmtDuration(min: number): string {
  if (min % 1440 === 0) return `${min / 1440}j`;
  if (min % 60 === 0) return `${min / 60}h`;
  return `${min}min`;
}

// Mêmes alphabets que le générateur serveur (voucher.service.ts) : sans I, O,
// 0 et 1 en alphanumérique, qui se confondent à l'impression thermique.
const SAMPLE_ALPHANUMERIC = 'K7F9QXZ3M2VBTRN4';
const SAMPLE_NUMERIC = '9831720465198327';

/** Aperçu du code tel qu'il sortira, à la longueur et au préfixe choisis. */
function sampleCode(
  format: PlanCodeFormat,
  prefix: string,
  length: string,
): string {
  const n = Math.min(
    CODE_LENGTH_MAX,
    Math.max(CODE_LENGTH_MIN, Number.parseInt(length, 10) || CODE_LENGTH_MIN),
  );
  const pool = format === 'NUMERIC' ? SAMPLE_NUMERIC : SAMPLE_ALPHANUMERIC;
  return prefix.trim() + pool.slice(0, n);
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
  const toast = useToast();

  const query = useQuery({
    queryKey: ['plans', routerId],
    queryFn: () => api.plans.list(routerId),
    enabled: Boolean(routerId),
    placeholderData: keepPreviousData,
  });

  const deviceProfilesQuery = useQuery({
    queryKey: ['device-profiles', routerId],
    queryFn: async (): Promise<RouterProfile[]> => {
      const creds = await getLocalCredentials(routerId);
      if (creds) return listUserProfilesLan(creds);
      const profiles = await api.routers.listUserProfiles(routerId);
      return profiles.map((p: UserProfile) => ({
        id: p.id,
        name: p.name,
        sharedUsers: p.sharedUsers,
        rateLimit: p.rateLimit,
      }));
    },
    enabled: Boolean(routerId),
    placeholderData: keepPreviousData,
  });

  const managedSlugs = new Set(query.data?.map((p: Plan) => p.userProfile) ?? []);
  const unmanagedProfiles = (deviceProfilesQuery.data ?? []).filter(
    (p) => !managedSlugs.has(p.name),
  );

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
  const [submitted, setSubmitted] = useState(false);
  const [serverErrors, setServerErrors] = useState<FieldErrors>({});

  const durationMinutes =
    (Number.parseInt(days, 10) || 0) * 1440 +
    (Number.parseInt(hours, 10) || 0) * 60 +
    (Number.parseInt(minutes, 10) || 0);

  /**
   * Validation calculée, pas déduite au moment du clic : le bouton reflète
   * l'état réel du formulaire au lieu de le refuser après coup avec un
   * message vague (« Nom, durée et prix sont requis »).
   */
  const errors = useMemo(() => {
    const e: FieldErrors = {};
    if (!name.trim()) e.name = 'Donnez un nom au forfait.';
    else if (name.trim().length < 2) e.name = 'Au moins 2 caractères.';
    if (price === '') e.priceXof = 'Indiquez un prix (0 = gratuit).';
    if (durationMinutes <= 0) e.durationMinutes = 'La durée doit être supérieure à 0.';
    const len = Number.parseInt(codeLength, 10);
    if (Number.isNaN(len)) e.codeLength = 'Obligatoire.';
    else if (len < CODE_LENGTH_MIN)
      e.codeLength = `Minimum ${CODE_LENGTH_MIN} caractères (trop court = devinable).`;
    else if (len > CODE_LENGTH_MAX)
      e.codeLength = `Maximum ${CODE_LENGTH_MAX} caractères (trop long à recopier).`;
    const users = Number.parseInt(maxUsers, 10);
    if (Number.isNaN(users) || users < 1) e.sharedUsers = 'Au moins 1 utilisateur.';
    return e;
  }, [codeLength, durationMinutes, maxUsers, name, price]);

  const valid = Object.keys(errors).length === 0;
  // Tant que rien n'a été soumis, on n'affiche que ce que le champ signale
  // lui-même au blur — pas un formulaire rouge dès l'ouverture.
  const shownError = (key: string): string | null =>
    serverErrors[key] ?? (submitted ? (errors[key] ?? null) : null);

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
    setSubmitted(false);
    setServerErrors({});
  }

  function startEdit(p: Plan) {
    setMenuFor(null);
    setSubmitted(false);
    setServerErrors({});
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
    // Un forfait créé avant cette règle peut porter 4, 5 ou 6 : on le remonte
    // au minimum plutôt que d'ouvrir le formulaire déjà en faute.
    setCodeLength(
      String(Math.min(CODE_LENGTH_MAX, Math.max(CODE_LENGTH_MIN, p.codeLength))),
    );
    setCodeFormat(p.codeFormat);
    setShowForm(true);
  }

  async function submit() {
    setSubmitted(true);
    setServerErrors({});
    if (!valid) return;

    setBusy(true);
    try {
      const payload = {
        name: name.trim(),
        durationMinutes,
        priceXof: Number.parseInt(price, 10),
        downloadKbps: downMbps ? Number.parseInt(downMbps, 10) * 1000 : null,
        uploadKbps: upMbps ? Number.parseInt(upMbps, 10) * 1000 : null,
        sharedUsers: Number.parseInt(maxUsers, 10),
        expirationMode,
        codePrefix: codePrefix.trim() || null,
        codeLength: Number.parseInt(codeLength, 10),
        codeFormat,
      };
      if (editingId) {
        await api.plans.update(routerId, editingId, payload);
      } else {
        await api.plans.create(routerId, payload);
      }
      toast.success(editingId ? 'Forfait mis à jour.' : 'Forfait créé.');
      resetForm();
      setShowForm(false);
      await qc.invalidateQueries({ queryKey: ['plans', routerId] });
    } catch (e) {
      const described = describeError(e);
      setServerErrors(described.fieldErrors);
      toast.error(described.message);
    } finally {
      setBusy(false);
    }
  }

  async function remove(id: string) {
    try {
      await api.plans.remove(routerId, id);
      toast.success('Forfait supprimé.');
      await qc.invalidateQueries({ queryKey: ['plans', routerId] });
    } catch (e) {
      toast.error(describeError(e).message);
    }
  }

  return (
    <View style={{ flex: 1, backgroundColor: theme.bg }}>
      <AppHeader title="Forfaits" back />
      <ScrollView contentContainerStyle={{ gap: 16, padding: 16, paddingBottom: 100 }}>
        <Row>
          <View style={{ flex: 1, paddingRight: 12 }}>
            <Title>Forfaits & Plans WiFi</Title>
            <Subtitle>Définissez les tarifs, vitesses et durées</Subtitle>
          </View>
          <Press
            accessibilityLabel={showForm ? 'Fermer le formulaire' : 'Nouveau forfait'}
            onPress={() => {
              if (showForm) {
                setShowForm(false);
                resetForm();
              } else {
                resetForm();
                setShowForm(true);
              }
            }}
            scaleTo={0.9}
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
          </Press>
        </Row>

        {showForm ? (
          <FadeIn>
          <Card>
            <Label>{editingId ? 'Modifier le forfait' : 'Nouveau forfait'}</Label>
            <Row style={{ gap: 12, alignItems: 'flex-start' }}>
              <View style={{ flex: 2 }}>
                <Field
                  label="Nom"
                  value={name}
                  onChangeText={setName}
                  placeholder="Ex. 1 Heure"
                  maxLength={100}
                  error={shownError('name')}
                />
              </View>
              <View style={{ flex: 1 }}>
                <NumberField
                  label="Prix (FCFA)"
                  value={price}
                  onChangeValue={setPrice}
                  min={0}
                  max={10_000_000}
                  placeholder="200"
                  error={shownError('priceXof')}
                />
              </View>
            </Row>

            <Row style={{ gap: 12, alignItems: 'flex-start' }}>
              <View style={{ flex: 1 }}>
                <NumberField
                  label="Users max"
                  value={maxUsers}
                  onChangeValue={setMaxUsers}
                  min={1}
                  max={1000}
                  placeholder="1"
                  error={shownError('sharedUsers')}
                />
              </View>
              <View style={{ flex: 1 }}>
                <NumberField
                  label="Upload (Mb/s)"
                  value={upMbps}
                  onChangeValue={setUpMbps}
                  min={1}
                  max={1000}
                  placeholder="Illimité"
                  optional
                />
              </View>
              <View style={{ flex: 1 }}>
                <NumberField
                  label="Download (Mb/s)"
                  value={downMbps}
                  onChangeValue={setDownMbps}
                  min={1}
                  max={1000}
                  placeholder="Illimité"
                  optional
                />
              </View>
            </Row>

            <View>
              <Label>Type de décompte temps</Label>
              <Row style={{ gap: 8, alignItems: 'stretch' }}>
                <SegmentedOption
                  active={expirationMode === 'ELAPSED'}
                  onPress={() => setExpirationMode('ELAPSED')}
                  title="Temps écoulé"
                  desc="Le chrono tourne dès la 1ère connexion"
                />
                <SegmentedOption
                  active={expirationMode === 'RADIO_PAUSE'}
                  onPress={() => setExpirationMode('RADIO_PAUSE')}
                  title="Pause radio"
                  desc="Le décompte s'arrête à la déconnexion"
                />
              </Row>
            </View>

            <View>
              <Label>Durée de validité</Label>
              <Row style={{ gap: 12, alignItems: 'flex-start' }}>
                <View style={{ flex: 1 }}>
                  <NumberField label="Jours" value={days} onChangeValue={setDays} max={365} />
                </View>
                <View style={{ flex: 1 }}>
                  <NumberField label="Heures" value={hours} onChangeValue={setHours} max={23} />
                </View>
                <View style={{ flex: 1 }}>
                  <NumberField
                    label="Minutes"
                    value={minutes}
                    onChangeValue={setMinutes}
                    max={59}
                  />
                </View>
              </Row>
              <FieldError>{shownError('durationMinutes')}</FieldError>
            </View>

            <View>
              <Label>Format du code</Label>
              <Row style={{ gap: 12, alignItems: 'flex-start' }}>
                <View style={{ flex: 2 }}>
                  <Field
                    label="Préfixe"
                    value={codePrefix}
                    onChangeText={(v) => setCodePrefix(v.replace(/[^A-Za-z0-9]/g, ''))}
                    placeholder="Ex. 1h"
                    autoCapitalize="none"
                    maxLength={12}
                    error={shownError('codePrefix')}
                  />
                </View>
                <View style={{ flex: 1 }}>
                  <NumberField
                    label="Longueur"
                    value={codeLength}
                    onChangeValue={setCodeLength}
                    min={CODE_LENGTH_MIN}
                    max={CODE_LENGTH_MAX}
                    maxLength={2}
                    placeholder="8"
                    error={shownError('codeLength')}
                  />
                </View>
              </Row>
              <Text style={{ color: theme.textMuted, fontSize: 11, marginTop: 6 }}>
                Entre {CODE_LENGTH_MIN} et {CODE_LENGTH_MAX} caractères, préfixe non
                compris.
              </Text>
              <Row style={{ gap: 8, marginTop: 12, alignItems: 'stretch' }}>
                <SegmentedOption
                  active={codeFormat === 'ALPHANUMERIC'}
                  onPress={() => setCodeFormat('ALPHANUMERIC')}
                  title="Lettres + Chiffres"
                  desc={`Ex. ${sampleCode('ALPHANUMERIC', codePrefix, codeLength)}`}
                />
                <SegmentedOption
                  active={codeFormat === 'NUMERIC'}
                  onPress={() => setCodeFormat('NUMERIC')}
                  title="Chiffres uniquement"
                  desc={`Ex. ${sampleCode('NUMERIC', codePrefix, codeLength)}`}
                />
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
          </FadeIn>
        ) : null}

        {query.isLoading ? (
          <View style={{ gap: 12 }}>
            <SkeletonCard />
            <SkeletonCard />
          </View>
        ) : query.isError ? (
          <ErrorState
            message={describeError(query.error).message}
            onRetry={() => query.refetch()}
            retrying={query.isFetching}
          />
        ) : !query.data?.length ? (
          <Empty
            icon="pricetags-outline"
            text="Aucun forfait pour ce routeur."
            action={{
              label: 'Créer le premier forfait',
              onPress: () => {
                resetForm();
                setShowForm(true);
              },
            }}
          />
        ) : (
          <View style={{ gap: 12 }}>
            {query.data.map((p: Plan, index: number) => (
              <FadeIn key={p.id} delay={index * 55}>
              <Card style={{ gap: 12 }}>
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
                        <Ionicons name="time-outline" size={13} color={theme.textMuted} />
                        <Text style={{ color: theme.textMuted, fontSize: 12 }}>
                          {fmtDuration(p.durationMinutes)}
                        </Text>
                        <Text style={{ color: theme.textMuted, fontSize: 12 }}>•</Text>
                        <Text style={{ color: theme.textMuted, fontSize: 12 }}>
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
                  <Press
                    accessibilityLabel="Options du forfait"
                    onPress={() => setMenuFor(menuFor === p.id ? null : p.id)}
                    hitSlop={8}
                    scaleTo={0.85}
                    style={{ padding: 4 }}
                  >
                    <Ionicons name="ellipsis-vertical" size={18} color={theme.textMuted} />
                  </Press>
                </Row>

                {menuFor === p.id ? (
                  <FadeIn from={-6} style={{ gap: 8 }}>
                    <Press
                      accessibilityLabel="Modifier ce forfait"
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
                    </Press>
                    <Press
                      accessibilityLabel="Supprimer ce forfait"
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
                    </Press>
                  </FadeIn>
                ) : null}

                <Row
                  style={{
                    gap: 8,
                    paddingTop: 12,
                    borderTopWidth: 1,
                    borderTopColor: theme.border,
                  }}
                >
                  {/* Attributs techniques : gris. La couleur est réservée au
                      prix (vert) et au statut — pas à la décoration. */}
                  <Chip
                    icon="flash-outline"
                    color={theme.textMuted}
                    label={speedLabel(p)}
                  />
                  <Chip
                    icon="people-outline"
                    color={theme.textMuted}
                    label={`${p.sharedUsers} user${p.sharedUsers > 1 ? 's' : ''}`}
                  />
                  <Chip
                    icon="key-outline"
                    color={theme.textMuted}
                    label={`${p.codeLength} car.`}
                  />
                </Row>
              </Card>
              </FadeIn>
            ))}
          </View>
        )}
        {unmanagedProfiles.length > 0 ? (
          <View style={{ gap: 12 }}>
            <Subtitle>Profils déjà sur le routeur</Subtitle>
            {unmanagedProfiles.map((p) => (
              <Card key={p.id} style={{ gap: 8 }}>
                <Row style={{ alignItems: 'center' }}>
                  <Row style={{ gap: 10, flex: 1, justifyContent: 'flex-start' }}>
                    <View
                      style={{
                        width: 38,
                        height: 38,
                        borderRadius: 12,
                        backgroundColor: theme.secondary + '22',
                        borderWidth: 1,
                        borderColor: theme.secondary + '55',
                        alignItems: 'center',
                        justifyContent: 'center',
                      }}
                    >
                      <Ionicons name="server-outline" size={18} color={theme.secondary} />
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={{ color: theme.text, fontWeight: '600', fontSize: 14 }}>
                        {p.name}
                      </Text>
                      <Row style={{ justifyContent: 'flex-start', gap: 8, marginTop: 2 }}>
                        <Text style={{ color: theme.textMuted, fontSize: 11 }}>
                          {p.sharedUsers} user{p.sharedUsers > 1 ? 's' : ''}
                        </Text>
                        {p.rateLimit ? (
                          <Text style={{ color: theme.textMuted, fontSize: 11 }}>
                            {p.rateLimit}
                          </Text>
                        ) : null}
                      </Row>
                    </View>
                  </Row>
                  <Badge label="ROUTEUR" tone="secondary" />
                </Row>
              </Card>
            ))}
          </View>
        ) : null}
      </ScrollView>
      <BottomNav active="plans" />
    </View>
  );
}
