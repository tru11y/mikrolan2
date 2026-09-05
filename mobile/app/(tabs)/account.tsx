import { useCallback, useState } from 'react';
import { Linking, Modal, ScrollView, Switch, Text, View, Pressable, FlatList } from 'react-native';
import { useRouter } from 'expo-router';
import { useFocusEffect } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import i18n from '@/src/i18n';
import AsyncStorage from '@react-native-async-storage/async-storage';
import Constants from 'expo-constants';
import { useAuth } from '@/src/providers/auth-provider';
import { useAppLock } from '@/src/providers/app-lock-provider';
import { usePushStatus } from '@/src/providers/push-notifications-provider';
import { useBatteryOptimization } from '@/src/hooks/use-battery-optimization';
import { useTheme } from '@/src/providers/theme-provider';
import { useThemeMode } from '@/src/providers/theme-provider';
import { api, extractErrorMessage } from '@/src/lib/api';
import {
  Banner,
  Button,
  Card,
  FadeIn,
  Field,
  Mono,
  Press,
  Row,
  space,
  type,
  weight,
  withAlpha,
} from '@/src/components/ui';
import { BottomNav, useBottomNavHeight } from '@/src/components/BottomNav';
import { AppHeader } from '@/src/components/AppHeader';

const COUNTRIES = [
  { code: 'SN', name: 'Sénégal', flag: '🇸🇳', lang: 'fr' },
  { code: 'CI', name: "Côte d'Ivoire", flag: '🇨🇮', lang: 'fr' },
  { code: 'ML', name: 'Mali', flag: '🇲🇱', lang: 'fr' },
  { code: 'BF', name: 'Burkina Faso', flag: '🇧🇫', lang: 'fr' },
  { code: 'GN', name: 'Guinée', flag: '🇬🇳', lang: 'fr' },
  { code: 'NE', name: 'Niger', flag: '🇳🇪', lang: 'fr' },
  { code: 'TD', name: 'Tchad', flag: '🇹🇩', lang: 'fr' },
  { code: 'CM', name: 'Cameroun', flag: '🇨🇲', lang: 'fr' },
  { code: 'GA', name: 'Gabon', flag: '🇬🇦', lang: 'fr' },
  { code: 'CG', name: 'Congo', flag: '🇨🇬', lang: 'fr' },
  { code: 'CD', name: 'RD Congo', flag: '🇨🇩', lang: 'fr' },
  { code: 'BJ', name: 'Bénin', flag: '🇧🇯', lang: 'fr' },
  { code: 'TG', name: 'Togo', flag: '🇹🇬', lang: 'fr' },
  { code: 'MG', name: 'Madagascar', flag: '🇲🇬', lang: 'fr' },
  { code: 'FR', name: 'France', flag: '🇫🇷', lang: 'fr' },
  { code: 'BE', name: 'Belgique', flag: '🇧🇪', lang: 'fr' },
  { code: 'CH', name: 'Suisse', flag: '🇨🇭', lang: 'fr' },
  { code: 'CA', name: 'Canada', flag: '🇨🇦', lang: 'fr' },
  { code: 'GB', name: 'United Kingdom', flag: '🇬🇧', lang: 'en' },
  { code: 'US', name: 'United States', flag: '🇺🇸', lang: 'en' },
  { code: 'NG', name: 'Nigeria', flag: '🇳🇬', lang: 'en' },
  { code: 'GH', name: 'Ghana', flag: '🇬🇭', lang: 'en' },
  { code: 'KE', name: 'Kenya', flag: '🇰🇪', lang: 'en' },
  { code: 'ZA', name: 'South Africa', flag: '🇿🇦', lang: 'en' },
  { code: 'TZ', name: 'Tanzania', flag: '🇹🇿', lang: 'en' },
  { code: 'UG', name: 'Uganda', flag: '🇺🇬', lang: 'en' },
  { code: 'RW', name: 'Rwanda', flag: '🇷🇼', lang: 'en' },
] as const;

function SettingRow({
  icon,
  iconColor,
  title,
  subtitle,
  right,
  onPress,
  danger,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  iconColor: string;
  title: string;
  subtitle?: string;
  right?: React.ReactNode;
  onPress?: () => void;
  danger?: boolean;
}) {
  const theme = useTheme();
  const Wrapper = onPress ? Press : View;
  return (
    <Wrapper
      {...(onPress ? { onPress } : {})}
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: 12,
        paddingVertical: 12,
        paddingHorizontal: 14,
      }}
    >
      <View style={{
        width: 34, height: 34, borderRadius: 10,
        backgroundColor: withAlpha(iconColor, 0.1),
        alignItems: 'center', justifyContent: 'center',
      }}>
        <Ionicons name={icon} size={15} color={iconColor} />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={{ color: danger ? theme.danger : theme.text, fontSize: 14, fontWeight: '600' }}>{title}</Text>
        {subtitle ? <Text style={{ color: theme.textMuted, fontSize: 11, marginTop: 1 }}>{subtitle}</Text> : null}
      </View>
      {right ?? (onPress ? <Ionicons name="chevron-forward" size={16} color={theme.textMuted} /> : null)}
    </Wrapper>
  );
}

function SectionCard({ children, delay }: { children: React.ReactNode; delay?: number }) {
  const theme = useTheme();
  return (
    <FadeIn delay={delay}>
      <View style={{
        backgroundColor: theme.surface,
        borderRadius: 14, overflow: 'hidden',
      }}>
        {children}
      </View>
    </FadeIn>
  );
}

function SectionSep() {
  const theme = useTheme();
  return <View style={{ height: 1, backgroundColor: theme.border, marginLeft: 60 }} />;
}

export default function AccountScreen() {
  const { t } = useTranslation();
  const theme = useTheme();
  const { mode: themeMode, setMode: setThemeMode } = useThemeMode();
  const navHeight = useBottomNavHeight();
  const router = useRouter();
  const { me, isPro, logout, refreshProfile } = useAuth();
  const pushStatus = usePushStatus();
  const {
    supported: appLockSupported,
    enabled: appLockEnabled,
    setEnabled: setAppLockEnabled,
  } = useAppLock();
  const [appLockBusy, setAppLockBusy] = useState(false);
  async function toggleAppLock(value: boolean) {
    setAppLockBusy(true);
    try { await setAppLockEnabled(value); } finally { setAppLockBusy(false); }
  }
  const battery = useBatteryOptimization();
  useFocusEffect(useCallback(() => { battery.recheck(); }, [battery.recheck]));
  const version = Constants.expoConfig?.version ?? '0.1.0';

  const [editingProfile, setEditingProfile] = useState(false);
  const [name, setName] = useState(me?.user.name ?? '');
  const [country, setCountry] = useState(me?.user.country ?? '');
  const [showCountryPicker, setShowCountryPicker] = useState(false);
  const [profileBusy, setProfileBusy] = useState(false);
  const [profileMsg, setProfileMsg] = useState<{ tone: 'success' | 'danger'; text: string } | null>(null);

  function selectCountry(c: typeof COUNTRIES[number]) {
    setCountry(c.name);
    setShowCountryPicker(false);
    i18n.changeLanguage(c.lang);
    AsyncStorage.setItem('mikrolan_language', c.lang).catch(() => {});
  }

  async function saveProfile() {
    setProfileBusy(true);
    setProfileMsg(null);
    try {
      await api.auth.updateProfile({ name: name.trim() || null, country: country.trim() || null });
      await refreshProfile();
      setProfileMsg({ tone: 'success', text: t('account.profileUpdated') });
      setEditingProfile(false);
    } catch (e) {
      setProfileMsg({ tone: 'danger', text: extractErrorMessage(e) });
    } finally {
      setProfileBusy(false);
    }
  }

  const [notifBusy, setNotifBusy] = useState(false);
  async function toggleNotifications(enabled: boolean) {
    setNotifBusy(true);
    try {
      await api.auth.updateNotifications(enabled);
      await refreshProfile();
    } catch (e) {
      setProfileMsg({ tone: 'danger', text: extractErrorMessage(e) });
    } finally {
      setNotifBusy(false);
    }
  }

  const [loggingOutAll, setLoggingOutAll] = useState(false);
  async function logoutAllSessions() {
    setLoggingOutAll(true);
    try { await api.auth.logoutAllSessions(); } catch {}
    await logout();
  }

  const [editingDelete, setEditingDelete] = useState(false);
  const [deletePassword, setDeletePassword] = useState('');
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [deleteMsg, setDeleteMsg] = useState<{ tone: 'success' | 'danger'; text: string } | null>(null);

  async function confirmDeleteAccount() {
    setDeleteBusy(true);
    setDeleteMsg(null);
    try {
      await api.auth.deleteAccount({ password: deletePassword });
      await logout();
    } catch (e) {
      setDeleteMsg({ tone: 'danger', text: extractErrorMessage(e) });
    } finally {
      setDeleteBusy(false);
    }
  }

  const [editingPassword, setEditingPassword] = useState(false);
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [passwordBusy, setPasswordBusy] = useState(false);
  const [passwordMsg, setPasswordMsg] = useState<{ tone: 'success' | 'danger'; text: string } | null>(null);

  async function savePassword() {
    setPasswordBusy(true);
    setPasswordMsg(null);
    try {
      await api.auth.changePassword(currentPassword, newPassword);
      setCurrentPassword('');
      setNewPassword('');
      setPasswordMsg({ tone: 'success', text: t('account.passwordChanged') });
      setTimeout(() => void logout(), 1200);
    } catch (e) {
      setPasswordMsg({ tone: 'danger', text: extractErrorMessage(e) });
    } finally {
      setPasswordBusy(false);
    }
  }

  async function setNewPasswordForOAuth() {
    setPasswordBusy(true);
    setPasswordMsg(null);
    try {
      await api.auth.setPassword(newPassword);
      setNewPassword('');
      setPasswordMsg({ tone: 'success', text: t('account.passwordSet') });
      await refreshProfile();
    } catch (e) {
      setPasswordMsg({ tone: 'danger', text: extractErrorMessage(e) });
    } finally {
      setPasswordBusy(false);
    }
  }

  const initials = (me?.user.name || me?.user.email || '?')
    .split(/[\s@]+/)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? '')
    .join('');

  return (
    <View style={{ flex: 1, backgroundColor: theme.bg }}>
      <AppHeader title={t('account.title')} />
      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{ padding: space.lg, gap: 14, paddingBottom: navHeight }}
      >
        {/* Profile header */}
        <FadeIn>
          <Card style={{ alignItems: 'center', gap: 10, paddingVertical: 24 }}>
            <View style={{
              width: 64, height: 64, borderRadius: 22,
              backgroundColor: withAlpha(theme.primary, 0.12),
              alignItems: 'center', justifyContent: 'center',
            }}>
              <Text style={{ color: theme.primary, fontSize: 22, fontWeight: '800' }}>{initials}</Text>
            </View>
            <Text style={{ color: theme.text, fontSize: 18, fontWeight: weight.bold }}>
              {me?.user.name || t('common.notSpecified')}
            </Text>
            <Mono style={{ color: theme.textMuted, fontSize: 12 }}>{me?.user.email}</Mono>
            {isPro ? (
              <View style={{
                flexDirection: 'row', alignItems: 'center', gap: 4,
                backgroundColor: withAlpha(theme.gold, 0.12),
                borderRadius: 8, paddingHorizontal: 10, paddingVertical: 4,
              }}>
                <Ionicons name="diamond" size={12} color={theme.gold} />
                <Text style={{ color: theme.gold, fontSize: 11, fontWeight: '700' }}>PRO</Text>
              </View>
            ) : null}
          </Card>
        </FadeIn>

        {/* Profile section */}
        <SectionCard delay={50}>
          <SettingRow
            icon="person-outline"
            iconColor={theme.primary}
            title={t('account.name')}
            subtitle={me?.user.name || t('common.notSpecified')}
            onPress={() => setEditingProfile((v) => !v)}
          />
          {editingProfile ? (
            <View style={{ gap: 10, padding: 14, paddingTop: 0 }}>
              {profileMsg ? <Banner tone={profileMsg.tone}>{profileMsg.text}</Banner> : null}
              <Field label={t('account.fullName')} value={name} onChangeText={setName} placeholder={t('account.namePlaceholder')} />
              <Button title={t('account.saveChanges')} onPress={saveProfile} loading={profileBusy} />
            </View>
          ) : null}
          <SectionSep />
          <SettingRow
            icon="flag-outline"
            iconColor={theme.success}
            title={t('account.country')}
            subtitle={country || me?.user.country || t('common.notSpecified')}
            onPress={() => setShowCountryPicker(true)}
          />
        </SectionCard>

        {/* Country picker modal */}
        <Modal visible={showCountryPicker} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => setShowCountryPicker(false)}>
          <View style={{ flex: 1, backgroundColor: theme.bg }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: space.lg, paddingTop: space.xl, paddingBottom: space.md, borderBottomWidth: 1, borderBottomColor: theme.border }}>
              <Text style={{ flex: 1, color: theme.text, fontSize: type.title, fontWeight: '700' }}>{t('account.country')}</Text>
              <Press accessibilityLabel={t('common.close')} onPress={() => setShowCountryPicker(false)} scaleTo={0.85}>
                <Ionicons name="close" size={24} color={theme.textMuted} />
              </Press>
            </View>
            <FlatList
              data={COUNTRIES}
              keyExtractor={(c) => c.code}
              contentContainerStyle={{ paddingBottom: space.xxl }}
              renderItem={({ item: c }) => (
                <Pressable
                  onPress={() => selectCountry(c)}
                  style={{
                    flexDirection: 'row', alignItems: 'center', gap: 10,
                    paddingVertical: 14, paddingHorizontal: space.lg,
                    backgroundColor: (country === c.name || me?.user.country === c.name) ? withAlpha(theme.primary, 0.1) : 'transparent',
                  }}
                >
                  <Text style={{ fontSize: 22 }}>{c.flag}</Text>
                  <Text style={{ color: theme.text, fontSize: type.body, fontWeight: '500', flex: 1 }}>{c.name}</Text>
                  {(country === c.name || me?.user.country === c.name) ? <Ionicons name="checkmark-circle" size={20} color={theme.primary} /> : null}
                </Pressable>
              )}
              ItemSeparatorComponent={() => <View style={{ height: 1, backgroundColor: theme.border, marginHorizontal: space.lg }} />}
            />
          </View>
        </Modal>

        {/* Preferences */}
        <SectionCard delay={100}>
          <SettingRow
            icon={themeMode === 'dark' ? 'moon' : 'sunny-outline'}
            iconColor={theme.warning}
            title={t('account.darkMode')}
            subtitle={themeMode === 'dark' ? t('account.darkModeOn') : t('account.darkModeOff')}
            right={
              <Switch
                value={themeMode === 'dark'}
                onValueChange={(v) => setThemeMode(v ? 'dark' : 'light')}
                trackColor={{ false: theme.border, true: theme.primary }}
                thumbColor={theme.onStrong}
              />
            }
          />
          <SectionSep />
          <SettingRow
            icon="notifications-outline"
            iconColor={theme.primary}
            title={t('account.notifications')}
            subtitle={t('account.notificationsSubtitle')}
            right={
              <Switch
                value={me?.user.notificationsEnabled ?? true}
                onValueChange={toggleNotifications}
                disabled={notifBusy}
                trackColor={{ false: theme.border, true: theme.primary }}
                thumbColor={theme.onStrong}
              />
            }
          />
          {pushStatus === 'permission_denied' ? (
            <View style={{ paddingHorizontal: 14, paddingBottom: 10, gap: 6 }}>
              <Banner tone="warning">{t('account.notificationsBlocked')}</Banner>
              <Press onPress={() => Linking.openSettings()}>
                <Text style={{ color: theme.primary, fontWeight: '700', fontSize: 12 }}>{t('account.openPhoneSettings')}</Text>
              </Press>
            </View>
          ) : pushStatus === 'missing_config' || pushStatus === 'failed' ? (
            <View style={{ paddingHorizontal: 14, paddingBottom: 10 }}>
              <Banner tone="warning">{t('account.notificationsUnavailable')}</Banner>
            </View>
          ) : null}
          {battery.available && battery.ignored === false ? (
            <View style={{ paddingHorizontal: 14, paddingBottom: 10, gap: 6 }}>
              <Banner tone="warning">{t('account.batteryWarning')}</Banner>
              <Press onPress={battery.request}>
                <Text style={{ color: theme.primary, fontWeight: '700', fontSize: 12 }}>{t('account.disableBatterySaver')}</Text>
              </Press>
            </View>
          ) : null}
          {appLockSupported ? (
            <>
              <SectionSep />
              <SettingRow
                icon="finger-print-outline"
                iconColor={theme.success}
                title={t('account.biometricLock')}
                subtitle={t('account.biometricSubtitle')}
                right={
                  <Switch
                    value={appLockEnabled}
                    onValueChange={toggleAppLock}
                    disabled={appLockBusy}
                    trackColor={{ false: theme.border, true: theme.primary }}
                    thumbColor={theme.onStrong}
                  />
                }
              />
            </>
          ) : null}
        </SectionCard>

        {/* Security */}
        <SectionCard delay={150}>
          <SettingRow
            icon="key-outline"
            iconColor={theme.warning}
            title={me?.user.hasPassword ? t('account.changePassword') : t('account.setPassword')}
            subtitle={!me?.user.hasPassword ? t('account.oauthAccount') : undefined}
            onPress={() => setEditingPassword((v) => !v)}
          />
          {editingPassword ? (
            <View style={{ gap: 10, padding: 14, paddingTop: 0 }}>
              {passwordMsg ? <Banner tone={passwordMsg.tone}>{passwordMsg.text}</Banner> : null}
              {me?.user.hasPassword ? (
                <Field label={t('account.currentPassword')} value={currentPassword} onChangeText={setCurrentPassword} secureTextEntry />
              ) : null}
              <Field
                label={me?.user.hasPassword ? t('account.newPassword') : t('login.password')}
                value={newPassword}
                onChangeText={setNewPassword}
                placeholder={t('login.passwordMinChars')}
                secureTextEntry
              />
              <Button
                title={me?.user.hasPassword ? t('account.changePassword') : t('account.setPassword')}
                variant="ghost"
                onPress={me?.user.hasPassword ? savePassword : setNewPasswordForOAuth}
                loading={passwordBusy}
                disabled={me?.user.hasPassword ? currentPassword.length < 1 || newPassword.length < 10 : newPassword.length < 10}
              />
            </View>
          ) : null}
          <SectionSep />
          <SettingRow
            icon="log-out-outline"
            iconColor={theme.textMuted}
            title={t('account.logoutAll')}
            subtitle={loggingOutAll ? t('account.loggingOut') : undefined}
            onPress={logoutAllSessions}
          />
        </SectionCard>

        {/* Actions */}
        <SectionCard delay={200}>
          {!isPro ? (
            <>
              <SettingRow
                icon="diamond-outline"
                iconColor={theme.warning}
                title={t('account.goProTitle')}
                subtitle={t('account.goProSubtitle')}
                onPress={() => router.push('/pro')}
              />
              <SectionSep />
            </>
          ) : null}
          <SettingRow
            icon="chatbubble-ellipses-outline"
            iconColor={theme.primary}
            title={t('account.supportTitle')}
            subtitle={t('account.supportSubtitle')}
            onPress={() => router.push('/support')}
          />
          {me?.user.role === 'SUPER_ADMIN' ? (
            <>
              <SectionSep />
              <SettingRow
                icon="shield-checkmark-outline"
                iconColor={theme.success}
                title={t('account.adminTitle')}
                subtitle={t('account.adminSubtitle')}
                onPress={() => router.push('/admin')}
              />
            </>
          ) : null}
        </SectionCard>

        {/* Danger zone */}
        <SectionCard delay={250}>
          <SettingRow
            icon="trash-outline"
            iconColor={theme.danger}
            title={t('account.deleteAccount')}
            subtitle={t('account.deleteAccountSubtitle')}
            danger
            onPress={() => setEditingDelete((v) => !v)}
          />
          {editingDelete ? (
            <View style={{ gap: 10, padding: 14, paddingTop: 0 }}>
              {deleteMsg ? <Banner tone={deleteMsg.tone}>{deleteMsg.text}</Banner> : null}
              {me?.user.hasPassword ? (
                <>
                  <Field label={t('account.confirmPassword')} value={deletePassword} onChangeText={setDeletePassword} secureTextEntry />
                  <Button title={t('account.deleteConfirm')} variant="danger" onPress={confirmDeleteAccount} loading={deleteBusy} disabled={deletePassword.length < 1} />
                </>
              ) : (
                <Banner tone="danger">{t('account.deleteSetPasswordFirst')}</Banner>
              )}
            </View>
          ) : null}
        </SectionCard>

        {/* Footer */}
        <View style={{ gap: 8, alignItems: 'center', paddingTop: 8 }}>
          <View style={{ flexDirection: 'row', gap: 16 }}>
            <Press onPress={() => Linking.openURL('https://api.mikrolan.net/api/legal/terms')}>
              <Text style={{ color: theme.primary, fontSize: 11 }}>{t('common.cgu')}</Text>
            </Press>
            <Press onPress={() => Linking.openURL('https://api.mikrolan.net/api/legal/privacy')}>
              <Text style={{ color: theme.primary, fontSize: 11 }}>{t('common.privacyPolicy')}</Text>
            </Press>
          </View>
          <Mono style={{ color: withAlpha(theme.textMuted, 0.5), fontSize: 11 }}>
            MikroLan v{version}
          </Mono>
        </View>
      </ScrollView>
      <BottomNav active="account" />
    </View>
  );
}
