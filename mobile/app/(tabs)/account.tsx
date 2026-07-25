import { useState } from 'react';
import { ScrollView, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import Constants from 'expo-constants';
import { useAuth } from '@/src/providers/auth-provider';
import { api, extractErrorMessage } from '@/src/lib/api';
import {
  Badge,
  Banner,
  Button,
  Card,
  Field,
  Label,
  Row,
  Subtitle,
  theme,
  Title,
} from '@/src/components/ui';
import { BottomNav } from '@/src/components/BottomNav';

function DetailRow({
  label,
  value,
  mono,
}: {
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <View style={{ gap: 4 }}>
      <Label>{label}</Label>
      <Text
        style={{
          color: theme.text,
          fontSize: mono ? 13 : 15,
          fontFamily: mono ? theme.mono : undefined,
        }}
      >
        {value}
      </Text>
    </View>
  );
}

function initialsOf(name?: string): string {
  if (!name) return 'ML';
  const p = name.trim().split(/\s+/);
  return (p[0]?.[0] ?? 'M').concat(p[1]?.[0] ?? '').toUpperCase();
}

export default function AccountScreen() {
  const router = useRouter();
  const { me, isPro, logout, isBusy, apiBaseUrl, refreshProfile } = useAuth();
  const version = Constants.expoConfig?.version ?? '0.1.0';

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
    } catch (e) {
      setProfileMsg({ tone: 'danger', text: extractErrorMessage(e) });
    } finally {
      setProfileBusy(false);
    }
  }

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
      // Password change revokes every session server-side (security
      // boundary) — force a clean re-login rather than leave a stale token.
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
      contentContainerStyle={{ padding: 16, gap: 16, paddingBottom: 100 }}
    >
      <Title>Compte</Title>

      {/* Profile */}
      <Card>
        <Row style={{ justifyContent: 'flex-start', gap: 14 }}>
          <View
            style={{
              width: 52,
              height: 52,
              borderRadius: 26,
              backgroundColor: theme.primary,
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <Text style={{ color: theme.primaryText, fontWeight: '700', fontSize: 18 }}>
              {initialsOf(me?.tenant.name)}
            </Text>
          </View>
          <View style={{ flex: 1, gap: 4 }}>
            <Text style={{ color: theme.text, fontWeight: '700', fontSize: 16 }}>
              {me?.tenant.name ?? '—'}
            </Text>
            <Text
              style={{
                color: theme.textMuted,
                fontSize: 13,
                fontFamily: theme.mono,
              }}
            >
              {me?.user.email ?? '—'}
            </Text>
            <Badge label="Compte vérifié" tone="success" />
          </View>
        </Row>
      </Card>

      {/* Profil éditable (réf: Nom Complet, Pays/Région) */}
      <Card style={{ gap: 12 }}>
        <Label>Mon profil</Label>
        {profileMsg ? (
          <Banner tone={profileMsg.tone}>{profileMsg.text}</Banner>
        ) : null}
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
      </Card>

      {/* Changer le mot de passe */}
      <Card style={{ gap: 12 }}>
        <Label>Changer le mot de passe</Label>
        {passwordMsg ? (
          <Banner tone={passwordMsg.tone}>{passwordMsg.text}</Banner>
        ) : null}
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
      </Card>

      {/* Subscription */}
      <Card style={{ borderColor: theme.gold }}>
        <Row>
          <Label>Abonnement</Label>
          <Badge label={me?.subscription?.plan ?? 'FREE'} tone={isPro ? 'gold' : 'muted'} />
        </Row>
        <Subtitle>
          {isPro
            ? 'Gestion à distance activée (tunnel WireGuard).'
            : 'Plan gratuit : gestion locale (LAN). Passez à PRO pour piloter vos routeurs à distance.'}
        </Subtitle>
        {!isPro ? (
          <Button
            title="Passer à PRO"
            variant="gold"
            onPress={() => router.push('/pro')}
          />
        ) : null}
      </Card>

      {/* Network */}
      <Card>
        <DetailRow label="Rôle" value={me?.user.role ?? '—'} mono />
        <DetailRow label="Serveur API" value={apiBaseUrl} mono />
      </Card>

      <Button
        title="Se déconnecter"
        variant="danger"
        onPress={logout}
        loading={isBusy}
      />

      <Text style={{ color: theme.textMuted, fontSize: 12, textAlign: 'center' }}>
        MikroLan2 v{version}
      </Text>
    </ScrollView>
    <BottomNav active="account" />
    </View>
  );
}
