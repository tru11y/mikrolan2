export { ScreenErrorBoundary as ErrorBoundary } from '@/src/components/ScreenErrorBoundary';
import { useState } from 'react';
import { ScrollView, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  api,
  extractErrorMessage,
  type RouterItem,
  type RouterLinkAuthMode,
  type RouterLinkView,
} from '@/src/lib/api';
import { useAuth } from '@/src/providers/auth-provider';
import { useTheme } from '@/src/providers/theme-provider';
import {
  Banner,
  Button,
  ConfirmDialog,
  Empty,
  Field,
  Press,
  SegmentedOption,
  Subtitle,
  Title,
  space,
} from '@/src/components/ui';
import { AppHeader } from '@/src/components/AppHeader';
import { BottomNav, useBottomNavHeight } from '@/src/components/BottomNav';

/**
 * Liaison de routeurs (option payante Entreprise) : mutualiser 2+ routeurs sur
 * un seul hotspot avec quota partagé (RADIUS). Les cadenas et toute la décision
 * métier viennent du serveur : l'écran lit `entitlement.routerLinking` et
 * délègue chaque action à l'API (jamais de logique métier ici).
 */
export default function RouterLinksScreen() {
  const theme = useTheme();
  const router = useRouter();
  const qc = useQueryClient();
  const navHeight = useBottomNavHeight();
  const { entitlement } = useAuth();
  const allowed = entitlement.routerLinking;

  if (!allowed) {
    return (
      <View style={{ flex: 1, backgroundColor: theme.bg }}>
        <AppHeader title="Liens de routeurs" back />
        <ScrollView contentContainerStyle={{ padding: space.lg, gap: space.lg }}>
          <View
            style={{
              backgroundColor: theme.surface,
              borderRadius: 16,
              padding: space.lg,
              gap: space.md,
              alignItems: 'center',
            }}
          >
            <Ionicons name="git-network-outline" size={40} color={theme.gold} />
            <Title>Mutualisez vos routeurs</Title>
            <Text style={{ color: theme.textMuted, textAlign: 'center' }}>
              Reliez deux routeurs ou plus pour qu’un même ticket Wi‑Fi fonctionne
              sur tous, avec un quota (data / temps) partagé. Option incluse dans la
              formule Entreprise.
            </Text>
            <Button title="Voir les formules" variant="gold" onPress={() => router.push('/pro')} />
          </View>
        </ScrollView>
        <BottomNav active="index" />
      </View>
    );
  }

  return <RouterLinksManager theme={theme} router={router} qc={qc} navHeight={navHeight} />;
}

function RouterLinksManager({
  theme,
  router,
  qc,
  navHeight,
}: {
  theme: ReturnType<typeof useTheme>;
  router: ReturnType<typeof useRouter>;
  qc: ReturnType<typeof useQueryClient>;
  navHeight: number;
}) {
  const [error, setError] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [name, setName] = useState('');
  const [authMode, setAuthMode] = useState<RouterLinkAuthMode>('RADIUS');
  const [selected, setSelected] = useState<string[]>([]);
  const [confirm, setConfirm] = useState<{ linkId: string; routerId: string } | null>(null);

  const linksQuery = useQuery({ queryKey: ['router-links'], queryFn: () => api.routerLinks.list() });
  const routersQuery = useQuery({ queryKey: ['routers'], queryFn: () => api.routers.list() });

  const invalidate = () => qc.invalidateQueries({ queryKey: ['router-links'] });
  const run = <T,>(fn: () => Promise<T>) => {
    setError(null);
    return fn().catch((e) => {
      setError(extractErrorMessage(e));
      throw e;
    });
  };

  const createM = useMutation({
    mutationFn: () => api.routerLinks.create({ name: name.trim(), authMode, routerIds: selected }),
    onSuccess: () => {
      setShowCreate(false);
      setName('');
      setSelected([]);
      invalidate();
    },
  });
  const activateM = useMutation({ mutationFn: (id: string) => api.routerLinks.activate(id), onSuccess: invalidate });
  const deactivateM = useMutation({ mutationFn: (id: string) => api.routerLinks.deactivate(id), onSuccess: invalidate });
  const removeM = useMutation({
    mutationFn: (v: { linkId: string; routerId: string }) => api.routerLinks.removeMember(v.linkId, v.routerId),
    onSuccess: invalidate,
  });

  const links = linksQuery.data ?? [];
  const routers = routersQuery.data ?? [];
  const canCreate = name.trim().length > 0 && selected.length >= 1 && !createM.isPending;

  const toggleRouter = (id: string) =>
    setSelected((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));

  return (
    <View style={{ flex: 1, backgroundColor: theme.bg }}>
      <AppHeader title="Liens de routeurs" back />
      <ScrollView contentContainerStyle={{ padding: space.lg, gap: space.lg, paddingBottom: navHeight }}>
        {error ? <Banner tone="danger">{error}</Banner> : null}

        {!showCreate ? (
          <Button title="Nouveau lien" onPress={() => setShowCreate(true)} />
        ) : (
          <View style={{ backgroundColor: theme.surface, borderRadius: 16, padding: space.lg, gap: space.md }}>
            <Title>Nouveau lien</Title>
            <Field label="Nom du lien" value={name} onChangeText={setName} placeholder="Hotspot Centre" />
            <Subtitle>Mode d’authentification</Subtitle>
            <View style={{ flexDirection: 'row', gap: space.sm }}>
              <SegmentedOption
                active={authMode === 'RADIUS'}
                onPress={() => setAuthMode('RADIUS')}
                title="RADIUS"
                desc="Quota partagé (VPS)"
                icon="shield-checkmark-outline"
              />
              <SegmentedOption
                active={authMode === 'DIRECT'}
                onPress={() => setAuthMode('DIRECT')}
                title="Direct"
                desc="Sans quota partagé"
                icon="link-outline"
              />
            </View>
            <Subtitle>Routeurs du lien</Subtitle>
            {routers.length === 0 ? (
              <Text style={{ color: theme.textMuted }}>Aucun routeur disponible.</Text>
            ) : (
              routers.map((r: RouterItem) => {
                const on = selected.includes(r.id);
                return (
                  <Press
                    key={r.id}
                    onPress={() => toggleRouter(r.id)}
                    style={{
                      flexDirection: 'row',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      padding: space.md,
                      borderWidth: 1,
                      borderColor: on ? theme.primary : theme.border,
                      borderRadius: 12,
                    }}
                  >
                    <View>
                      <Text style={{ color: theme.text, fontWeight: '600' }}>{r.alias ?? r.identity}</Text>
                      <Text style={{ color: theme.textMuted, fontSize: 12 }}>{r.mode}</Text>
                    </View>
                    <Ionicons
                      name={on ? 'checkmark-circle' : 'ellipse-outline'}
                      size={22}
                      color={on ? theme.primary : theme.textMuted}
                    />
                  </Press>
                );
              })
            )}
            {authMode === 'RADIUS' ? (
              <Text style={{ color: theme.textMuted, fontSize: 12 }}>
                Le mode RADIUS requiert des routeurs en accès distant (REMOTE).
              </Text>
            ) : null}
            <View style={{ flexDirection: 'row', gap: space.sm }}>
              <View style={{ flex: 1 }}>
                <Button title="Annuler" variant="ghost" onPress={() => setShowCreate(false)} />
              </View>
              <View style={{ flex: 1 }}>
                <Button
                  title="Créer"
                  onPress={() => run(() => createM.mutateAsync()).catch(() => {})}
                  loading={createM.isPending}
                  disabled={!canCreate}
                />
              </View>
            </View>
          </View>
        )}

        {links.length === 0 && !linksQuery.isLoading ? (
          <Empty text="Aucun lien pour l’instant." icon="git-network-outline" />
        ) : (
          links.map((link: RouterLinkView) => (
            <LinkCard
              key={link.id}
              link={link}
              theme={theme}
              onActivate={() => run(() => activateM.mutateAsync(link.id)).catch(() => {})}
              onDeactivate={() => run(() => deactivateM.mutateAsync(link.id)).catch(() => {})}
              onRemoveMember={(routerId) => setConfirm({ linkId: link.id, routerId })}
              busy={activateM.isPending || deactivateM.isPending}
            />
          ))
        )}
      </ScrollView>

      <ConfirmDialog
        visible={confirm !== null}
        icon="close-circle-outline"
        title="Retirer le routeur ?"
        message="Ce routeur ne partagera plus le hotspot ni le quota de ce lien."
        confirmLabel="Retirer"
        tone="danger"
        onCancel={() => setConfirm(null)}
        onConfirm={() => {
          const c = confirm;
          setConfirm(null);
          if (c) run(() => removeM.mutateAsync(c)).catch(() => {});
        }}
      />
      <BottomNav active="index" />
    </View>
  );
}

function LinkCard({
  link,
  theme,
  onActivate,
  onDeactivate,
  onRemoveMember,
  busy,
}: {
  link: RouterLinkView;
  theme: ReturnType<typeof useTheme>;
  onActivate: () => void;
  onDeactivate: () => void;
  onRemoveMember: (routerId: string) => void;
  busy: boolean;
}) {
  const isActive = link.status === 'ACTIVE';
  const isRadius = link.authMode === 'RADIUS';
  const statusColor = isActive ? theme.success : theme.textMuted;

  return (
    <View style={{ backgroundColor: theme.surface, borderRadius: 16, padding: space.lg, gap: space.md }}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
        <Title>{link.name}</Title>
        <Text style={{ color: statusColor, fontSize: 12, fontWeight: '700' }}>
          {isActive ? 'ACTIF' : 'ARCHIVÉ'}
        </Text>
      </View>
      <Text style={{ color: theme.textMuted, fontSize: 12 }}>
        {isRadius ? 'RADIUS · quota partagé' : 'Direct · sans quota partagé'}
      </Text>

      {link.routers.map((m) => (
        <View
          key={m.routerId}
          style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}
        >
          <View>
            <Text style={{ color: theme.text }}>{m.router.alias ?? m.router.identity}</Text>
            <Text style={{ color: theme.textMuted, fontSize: 11 }}>
              {m.router.mode}
              {isRadius ? (m.radiusReadyAt ? ' · provisionné' : ' · en attente') : ''}
            </Text>
          </View>
          <Press onPress={() => onRemoveMember(m.routerId)} accessibilityLabel="Retirer le routeur">
            <Ionicons name="close-circle-outline" size={20} color={theme.danger} />
          </Press>
        </View>
      ))}

      {isRadius ? (
        <Button
          title={isActive ? 'Désactiver' : 'Activer'}
          variant={isActive ? 'danger' : 'primary'}
          onPress={isActive ? onDeactivate : onActivate}
          loading={busy}
        />
      ) : null}
    </View>
  );
}
