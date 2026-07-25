import { useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import Constants from 'expo-constants';
import { useAuth } from '@/src/providers/auth-provider';
import { api, extractErrorMessage } from '@/src/lib/api';
import { Banner, Button, Field, Title, theme } from '@/src/components/ui';
import { BottomNav } from '@/src/components/BottomNav';

function Divider() {
  return <View style={{ height: 1, backgroundColor: theme.border }} />;
}

function StaticRow({ label, value }: { label: string; value: string }) {
  return (
    <View style={{ paddingVertical: 14, gap: 3 }}>
      <Text style={{ color: theme.textMuted, fontSize: 12 }}>{label}</Text>
      <Text style={{ color: theme.text, fontSize: 15, fontWeight: '700' }}>{value}</Text>
    </View>
  );
}

function ActionRow({
  title,
  subtitle,
  danger,
  onPress,
  open,
}: {
  title: string;
  subtitle?: string;
  danger?: boolean;
  onPress: () => void;
  open?: boolean;
}) {
  return (
    <Pressable
      onPress={onPress}
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        paddingVertical: 14,
        gap: 10,
      }}
    >
      <View style={{ flex: 1 }}>
        <Text
          style={{
            color: danger ? theme.danger : theme.text,
            fontSize: 15,
            fontWeight: '600',
          }}
        >
          {title}
        </Text>
        {subtitle ? (
          <Text style={{ color: theme.textMuted, fontSize: 12, marginTop: 2 }}>
            {subtitle}
          </Text>
        ) : null}
      </View>
      <Ionicons
        name={open ? 'chevron-down' : 'chevron-forward'}
        size={18}
        color={theme.textMuted}
      />
    </Pressable>
  );
}

export default function AccountScreen() {
  const router = useRouter();
  const { me, isPro, logout, refreshProfile } = useAuth();
  const version = Constants.expoConfig?.version ?? '0.1.0';

  const [editingProfile, setEditingProfile] = useState(false);
  const [name, setName] = useState(me?.user.name ?? '');
  const [country, setCountry] = useState(me?.user.country ?? '');
  const [profileBusy, setProfileBusy] = useState(false);
  const [profileMsg, setProfileMsg] = useState<
    { tone: 'success' | 'danger'; text: string } | null
  >(null);

  async function saveProfile() {
    setProfileBusy(true);
    setProfileMsg(null);
    try {
      await api.auth.updateProfile({
        name: name.trim() || null,
        country: country.trim() || null,
      });
      await refreshProfile();
      setProfileMsg({ tone: 'success', text: 'Profil mis à jour.' });
      setEditingProfile(false);
    } catch (e) {
      setProfileMsg({ tone: 'danger', text: extractErrorMessage(e) });
    } finally {
      setProfileBusy(false);
    }
  }

  const [editingPassword, setEditingPassword] = useState(false);
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [passwordBusy, setPasswordBusy] = useState(false);
  const [passwordMsg, setPasswordMsg] = useState<
    { tone: 'success' | 'danger'; text: string } | null
  >(null);

  async function savePassword() {
    setPasswordBusy(true);
    setPasswordMsg(null);
    try {
      await api.auth.changePassword(currentPassword, newPassword);
      setCurrentPassword('');
      setNewPassword('');
      setPasswordMsg({
        tone: 'success',
        text: 'Mot de passe changé. Reconnexion requise…',
      });
      // Password change revokes every session server-side — force a clean
      // re-login rather than leave a stale token.
      setTimeout(() => void logout(), 1200);
    } catch (e) {
      setPasswordMsg({ tone: 'danger', text: extractErrorMessage(e) });
    } finally {
      setPasswordBusy(false);
    }
  }

  return (
    <View style={{ flex: 1, backgroundColor: theme.bg }}>
      <ScrollView
        style={{ flex: 1, backgroundColor: theme.bg }}
        contentContainerStyle={{ padding: 16, paddingBottom: 100 }}
      >
        <Title>Mon compte</Title>
        <View style={{ height: 12 }} />

        <StaticRow label="E-mail" value={me?.user.email ?? '—'} />
        <Divider />

        <ActionRow
          title="Nom"
          subtitle={!editingProfile ? me?.user.name || 'Non renseigné' : undefined}
          open={editingProfile}
          onPress={() => setEditingProfile((v) => !v)}
        />
        {editingProfile ? (
          <View style={{ gap: 12, paddingBottom: 16 }}>
            {profileMsg ? <Banner tone={profileMsg.tone}>{profileMsg.text}</Banner> : null}
            <Field
              label="Nom complet"
              value={name}
              onChangeText={setName}
              placeholder="Votre nom"
            />
            <Field
              label="Pays / Région"
              value={country}
              onChangeText={setCountry}
              placeholder="Ex. Côte d’Ivoire"
            />
            <Button
              title="Enregistrer les modifications"
              onPress={saveProfile}
              loading={profileBusy}
            />
          </View>
        ) : null}
        <Divider />

        <StaticRow label="Pays" value={me?.user.country || '—'} />
        <Divider />

        <ActionRow
          title="Changer le mot de passe"
          open={editingPassword}
          onPress={() => setEditingPassword((v) => !v)}
        />
        {editingPassword ? (
          <View style={{ gap: 12, paddingBottom: 16 }}>
            {passwordMsg ? <Banner tone={passwordMsg.tone}>{passwordMsg.text}</Banner> : null}
            <Field
              label="Mot de passe actuel"
              value={currentPassword}
              onChangeText={setCurrentPassword}
              secureTextEntry
            />
            <Field
              label="Nouveau mot de passe"
              value={newPassword}
              onChangeText={setNewPassword}
              placeholder="10 caractères minimum"
              secureTextEntry
            />
            <Button
              title="Changer le mot de passe"
              variant="ghost"
              onPress={savePassword}
              loading={passwordBusy}
              disabled={currentPassword.length < 1 || newPassword.length < 10}
            />
          </View>
        ) : null}
        <Divider />

        {!isPro ? (
          <>
            <ActionRow
              title="Passer à PRO"
              subtitle="Gestion à distance multi-routeurs (WireGuard)"
              onPress={() => router.push('/pro')}
            />
            <Divider />
          </>
        ) : null}

        <ActionRow title="Se déconnecter" danger onPress={logout} />

        <Text
          style={{
            color: theme.textMuted,
            fontSize: 12,
            textAlign: 'center',
            marginTop: 24,
          }}
        >
          MikroLan2 v{version}
        </Text>
      </ScrollView>
      <BottomNav active="account" />
    </View>
  );
}
