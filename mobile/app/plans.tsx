export { ScreenErrorBoundary as ErrorBoundary } from '@/src/components/ScreenErrorBoundary';
import { useMemo, useState } from 'react';
import { ScrollView, Text, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
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
import { verifiedLanCreds } from '@/src/lib/lanRouting';
import {
  listUserProfilesLan,
  removeUserProfileLan,
  updateUserProfileLan,
  type RouterProfile,
} from '@/src/services/mikrotik-lan/hotspotLan';
import { useTranslation } from 'react-i18next';
import { describeError, type FieldErrors } from '@/src/lib/errors';
import {
  Button,
  Card,
  ConfirmDialog,
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
  space,
  weight,
  useToast,
} from '@/src/components/ui';
import { useTheme } from '@/src/providers/theme-provider';
import { BottomNav } from '@/src/components/BottomNav';
import { AppHeader } from '@/src/components/AppHeader';
import { PlanListItem } from '@/src/components/plans/PlanListItem';
import { DeviceProfileCard } from '@/src/components/plans/DeviceProfileCard';
import { CODE_LENGTH_MAX, CODE_LENGTH_MIN, sampleCode } from '@/src/components/plans/shared';

export default function PlansScreen() {
  const theme = useTheme();
  const { routerId, onboarding } = useLocalSearchParams<{
    routerId: string;
    onboarding?: string;
  }>();
  const { t } = useTranslation();
  const router = useRouter();
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
      const creds = await verifiedLanCreds(routerId);
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
  // Profils qui vivent sur le routeur mais que l'app ne gère pas (créés avant
  // elle, ou depuis WebFig) : éditables/supprimables directement ici.
  const [deviceEditing, setDeviceEditing] = useState<RouterProfile | null>(null);
  const [deviceRemoving, setDeviceRemoving] = useState<RouterProfile | null>(null);
  const [deviceUsers, setDeviceUsers] = useState('1');
  const [deviceRate, setDeviceRate] = useState('');
  const [deviceBusy, setDeviceBusy] = useState(false);

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
    if (!name.trim()) e.name = t('plans.nameRequired');
    else if (name.trim().length < 2) e.name = t('plans.nameMinChars');
    if (price === '') e.priceXof = t('plans.priceRequired');
    if (durationMinutes <= 0) e.durationMinutes = t('plans.durationRequired');
    const len = Number.parseInt(codeLength, 10);
    if (Number.isNaN(len)) e.codeLength = t('common.required');
    else if (len < CODE_LENGTH_MIN)
      e.codeLength = t('plans.codeLengthMin', { min: CODE_LENGTH_MIN });
    else if (len > CODE_LENGTH_MAX)
      e.codeLength = t('plans.codeLengthMax', { max: CODE_LENGTH_MAX });
    const users = Number.parseInt(maxUsers, 10);
    if (Number.isNaN(users) || users < 1) e.sharedUsers = t('plans.usersMinOne');
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
    if (!valid || !routerId) return;

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
      const wasFirstPlan = !editingId && (query.data ?? []).length === 0;
      if (editingId) {
        await api.plans.update(routerId, editingId, payload);
      } else {
        await api.plans.create(routerId, payload);
      }
      toast.success(editingId ? t('plans.planUpdated') : t('plans.planCreated'));
      resetForm();
      setShowForm(false);
      await qc.invalidateQueries({ queryKey: ['plans', routerId] });
      if (wasFirstPlan && onboarding === '1') {
        router.replace({
          pathname: '/generate-vouchers',
          params: { routerId, onboarding: '1' },
        });
        return;
      }
    } catch (e) {
      const described = describeError(e);
      setServerErrors(described.fieldErrors);
      toast.error(described.message);
    } finally {
      setBusy(false);
    }
  }

  async function remove(id: string) {
    if (!routerId) return;
    try {
      await api.plans.remove(routerId, id);
      toast.success(t('plans.planDeleted'));
      await qc.invalidateQueries({ queryKey: ['plans', routerId] });
    } catch (e) {
      toast.error(describeError(e).message);
    }
  }

  /**
   * Credentials LAN, seulement si le routeur est sur le Wi-Fi courant. Hors
   * de son réseau on passe par le serveur (tunnel PRO) : ouvrir le socket
   * épinglé ailleurs échoue, et peut faire tomber l'app.
   */
  async function lanCredentials() {
    return verifiedLanCreds(routerId);
  }

  function startEditDevice(p: RouterProfile) {
    setDeviceEditing(p);
    setDeviceUsers(String(p.sharedUsers));
    setDeviceRate(p.rateLimit ?? '');
    setDeviceBusy(false);
  }

  async function saveDeviceProfile() {
    if (!deviceEditing) return;
    const users = Number.parseInt(deviceUsers, 10);
    if (Number.isNaN(users) || users < 1) {
      toast.error(t('plans.usersMinOne'));
      return;
    }
    const rate = deviceRate.trim();
    if (rate && !/^\d+[kMG]?\/\d+[kMG]?$/.test(rate)) {
      toast.error(t('plans.rateFormatError'));
      return;
    }
    setDeviceBusy(true);
    try {
      const patch = { sharedUsers: users, rateLimit: rate || null };
      const creds = await lanCredentials();
      if (creds) {
        await updateUserProfileLan(creds, deviceEditing.id, patch);
      } else {
        await api.routers.updateUserProfile(routerId, deviceEditing.id, patch);
      }
      toast.success(t('plans.deviceProfileUpdated'));
      setDeviceEditing(null);
      await qc.invalidateQueries({ queryKey: ['device-profiles', routerId] });
    } catch (e) {
      toast.error(describeError(e).message);
    } finally {
      setDeviceBusy(false);
    }
  }

  async function removeDeviceProfile() {
    if (!deviceRemoving) return;
    setDeviceBusy(true);
    try {
      const creds = await lanCredentials();
      if (creds) {
        await removeUserProfileLan(creds, deviceRemoving.id);
      } else {
        await api.routers.deleteUserProfile(routerId, deviceRemoving.id);
      }
      toast.success(t('plans.deviceProfileDeleted'));
      setDeviceRemoving(null);
      await qc.invalidateQueries({ queryKey: ['device-profiles', routerId] });
    } catch (e) {
      toast.error(describeError(e).message);
    } finally {
      setDeviceBusy(false);
    }
  }

  return (
    <View style={{ flex: 1, backgroundColor: theme.bg }}>
      <AppHeader title={t('plans.screenTitle')} back />
      <ScrollView contentContainerStyle={{ gap: 16, padding: 16, paddingBottom: 100 }}>
        <Row>
          <View style={{ flex: 1, paddingRight: 12 }}>
            <Title>{t('plans.titleFull')}</Title>
            <Subtitle>{t('plans.subtitle')}</Subtitle>
          </View>
          <Press
            accessibilityLabel={showForm ? t('plans.closeForm') : t('plans.newPlan')}
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

        {/* Summary KPIs */}
        {(query.data?.length ?? 0) > 0 ? (
          <FadeIn>
            <Row style={{ gap: 8 }}>
              <View style={{
                flex: 1, alignItems: 'center', gap: 4,
                backgroundColor: theme.surface,
                borderRadius: 14, paddingVertical: 12,
              }}>
                <Text style={{ color: theme.text, fontSize: 20, fontWeight: weight.heavy, fontFamily: theme.mono }}>
                  {query.data!.length}
                </Text>
                <Text style={{ color: theme.textMuted, fontSize: 10 }}>{t('plans.totalPlans')}</Text>
              </View>
              <View style={{
                flex: 1, alignItems: 'center', gap: 4,
                backgroundColor: theme.surface,
                borderRadius: 14, paddingVertical: 12,
              }}>
                <Text style={{ color: theme.success, fontSize: 20, fontWeight: weight.heavy, fontFamily: theme.mono }}>
                  {Math.round(query.data!.reduce((s, p) => s + p.priceXof, 0) / query.data!.length).toLocaleString('fr-FR')}
                </Text>
                <Text style={{ color: theme.textMuted, fontSize: 10 }}>{t('plans.avgPrice')}</Text>
              </View>
              <View style={{
                flex: 1, alignItems: 'center', gap: 4,
                backgroundColor: theme.surface,
                borderRadius: 14, paddingVertical: 12,
              }}>
                <Text style={{ color: theme.primary, fontSize: 20, fontWeight: weight.heavy, fontFamily: theme.mono }}>
                  {query.data!.reduce((s, p) => s + p.sharedUsers, 0)}
                </Text>
                <Text style={{ color: theme.textMuted, fontSize: 10 }}>{t('plans.totalUsers')}</Text>
              </View>
            </Row>
          </FadeIn>
        ) : null}

        {showForm ? (
          <FadeIn>
          <Card>
            <Label>{editingId ? t('plans.editPlan') : t('plans.newPlan')}</Label>
            <Row style={{ gap: 12, alignItems: 'flex-start' }}>
              <View style={{ flex: 2 }}>
                <Field
                  label={t('plans.nameLabel')}
                  value={name}
                  onChangeText={setName}
                  placeholder={t('plans.namePlaceholder')}
                  maxLength={100}
                  error={shownError('name')}
                />
              </View>
              <View style={{ flex: 1 }}>
                <NumberField
                  label={t('plans.priceLabel')}
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
                  label={t('plans.usersMax')}
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
                  label={t('plans.uploadSpeed')}
                  value={upMbps}
                  onChangeValue={setUpMbps}
                  min={1}
                  max={1000}
                  placeholder={t('common.unlimited')}
                  optional
                />
              </View>
              <View style={{ flex: 1 }}>
                <NumberField
                  label={t('plans.downloadSpeed')}
                  value={downMbps}
                  onChangeValue={setDownMbps}
                  min={1}
                  max={1000}
                  placeholder={t('common.unlimited')}
                  optional
                />
              </View>
            </Row>

            <View>
              <Label>{t('plans.expirationMode')}</Label>
              <Row style={{ gap: 8, alignItems: 'stretch' }}>
                <SegmentedOption
                  active={expirationMode === 'ELAPSED'}
                  onPress={() => setExpirationMode('ELAPSED')}
                  title={t('plans.elapsed')}
                  desc={t('plans.elapsedDesc')}
                />
                <SegmentedOption
                  active={expirationMode === 'RADIO_PAUSE'}
                  onPress={() => setExpirationMode('RADIO_PAUSE')}
                  title={t('plans.radioPause')}
                  desc={t('plans.radioPauseDesc')}
                />
              </Row>
            </View>

            <View>
              <Label>{t('plans.validityLabel')}</Label>
              <Row style={{ gap: 12, alignItems: 'flex-start' }}>
                <View style={{ flex: 1 }}>
                  <NumberField label={t('plans.daysLabel')} value={days} onChangeValue={setDays} max={365} />
                </View>
                <View style={{ flex: 1 }}>
                  <NumberField label={t('plans.hoursLabel')} value={hours} onChangeValue={setHours} max={23} />
                </View>
                <View style={{ flex: 1 }}>
                  <NumberField
                    label={t('plans.minutesLabel')}
                    value={minutes}
                    onChangeValue={setMinutes}
                    max={59}
                  />
                </View>
              </Row>
              <FieldError>{shownError('durationMinutes')}</FieldError>
            </View>

            <View>
              <Label>{t('plans.codeFormatLabel')}</Label>
              <Row style={{ gap: 12, alignItems: 'flex-start' }}>
                <View style={{ flex: 2 }}>
                  <Field
                    label={t('plans.prefix')}
                    value={codePrefix}
                    onChangeText={(v) => setCodePrefix(v.replace(/[^A-Za-z0-9]/g, ''))}
                    placeholder={t('plans.prefixPlaceholder')}
                    autoCapitalize="none"
                    maxLength={12}
                    error={shownError('codePrefix')}
                  />
                </View>
                <View style={{ flex: 1 }}>
                  <NumberField
                    label={t('plans.lengthLabel')}
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
                {t('plans.codeLengthRange', { min: CODE_LENGTH_MIN, max: CODE_LENGTH_MAX })}
              </Text>
              <Row style={{ gap: 8, marginTop: 12, alignItems: 'stretch' }}>
                <SegmentedOption
                  active={codeFormat === 'ALPHANUMERIC'}
                  onPress={() => setCodeFormat('ALPHANUMERIC')}
                  title={t('plans.alphanumeric')}
                  desc={`Ex. ${sampleCode('ALPHANUMERIC', codePrefix, codeLength)}`}
                />
                <SegmentedOption
                  active={codeFormat === 'NUMERIC'}
                  onPress={() => setCodeFormat('NUMERIC')}
                  title={t('plans.numericOnly')}
                  desc={`Ex. ${sampleCode('NUMERIC', codePrefix, codeLength)}`}
                />
              </Row>
            </View>

            {editingId ? (
              <Row style={{ gap: 8 }}>
                <View style={{ flex: 1 }}>
                  <Button
                    title={t('common.cancel')}
                    variant="ghost"
                    onPress={() => {
                      setShowForm(false);
                      resetForm();
                    }}
                  />
                </View>
                <View style={{ flex: 1 }}>
                  <Button title={t('plans.update')} onPress={submit} loading={busy} />
                </View>
              </Row>
            ) : (
              <Button title={t('plans.createPlan')} onPress={submit} loading={busy} />
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
            text={t('plans.noPlanForRouter')}
            action={{
              label: t('plans.createFirst'),
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
                <PlanListItem
                  plan={p}
                  menuOpen={menuFor === p.id}
                  onToggleMenu={() => setMenuFor(menuFor === p.id ? null : p.id)}
                  onEdit={() => startEdit(p)}
                  onDelete={() => {
                    setMenuFor(null);
                    remove(p.id);
                  }}
                />
              </FadeIn>
            ))}
          </View>
        )}
        {unmanagedProfiles.length > 0 ? (
          <View style={{ gap: 12 }}>
            <Subtitle>{t('plans.deviceProfiles')}</Subtitle>
            {unmanagedProfiles.map((p) => (
              <DeviceProfileCard
                key={p.id}
                profile={p}
                editing={deviceEditing?.id === p.id}
                users={deviceUsers}
                rate={deviceRate}
                busy={deviceBusy}
                onStartEdit={() => startEditDevice(p)}
                onCancelEdit={() => setDeviceEditing(null)}
                onChangeUsers={setDeviceUsers}
                onChangeRate={setDeviceRate}
                onSave={saveDeviceProfile}
                onRemove={() => setDeviceRemoving(p)}
              />
            ))}
          </View>
        ) : null}
      </ScrollView>

      <ConfirmDialog
        visible={deviceRemoving != null}
        icon="trash-outline"
        title={t('plans.deleteProfileTitle')}
        message={t('plans.deleteProfileMessage', { name: deviceRemoving?.name ?? '' })}
        confirmLabel={t('common.delete')}
        busy={deviceBusy}
        onConfirm={removeDeviceProfile}
        onCancel={() => setDeviceRemoving(null)}
      />
      <BottomNav active="plans" />
    </View>
  );
}
