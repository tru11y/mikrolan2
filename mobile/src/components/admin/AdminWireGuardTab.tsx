import { memo, useState } from 'react';
import { Modal, ScrollView, Text, View } from 'react-native';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, type WgPeerRow, type WgPeersResponse } from '@/src/lib/api';
import { describeError } from '@/src/lib/errors';
import {
  formatBytes,
  handshakeLine,
  revokeConfirmed,
  stateHint,
  WG_STATE_META,
  type WgPeerState,
  type WgTone,
} from '@/src/lib/wgDisplay';
import {
  Badge,
  Banner,
  Button,
  Card,
  ConfirmDialog,
  Empty,
  ErrorState,
  Field,
  Press,
  radius,
  Row,
  SkeletonCard,
  space,
  Title,
  type,
  useToast,
  withAlpha,
} from '@/src/components/ui';
import { useTheme } from '@/src/providers/theme-provider';

const REFRESH_MS = 20_000;

const FILTERS: { key: WgPeerState | null; label: string; count: (s: Summary) => number }[] = [
  { key: null, label: 'Tous', count: (s) => s.total },
  { key: 'HEALTHY', label: 'Healthy', count: (s) => s.healthy },
  { key: 'STALE', label: 'Stale', count: (s) => s.stale },
  { key: 'NEVER', label: 'Never', count: (s) => s.never },
  { key: 'REVOKED', label: 'Revoked', count: (s) => s.revoked },
  { key: 'ERROR', label: 'Error', count: (s) => s.error },
];

type Summary = WgPeersResponse['summary'];

function toneColor(tone: WgTone, theme: ReturnType<typeof useTheme>): string {
  switch (tone) {
    case 'success':
      return theme.success;
    case 'danger':
      return theme.danger;
    case 'warning':
      return theme.warning;
    case 'gold':
      return theme.gold;
    default:
      return theme.textMuted;
  }
}

const PeerCard = memo(function PeerCard({
  peer,
  onResync,
  onRevoke,
}: {
  peer: WgPeerRow;
  onResync: (p: WgPeerRow) => void;
  onRevoke: (p: WgPeerRow) => void;
}) {
  const theme = useTheme();
  const meta = WG_STATE_META[peer.state];
  const color = toneColor(meta.tone, theme);
  const hint = stateHint(peer);
  const heartbeatAgeS = peer.lastHeartbeat
    ? Math.max(0, (Date.now() - Date.parse(peer.lastHeartbeat)) / 1000)
    : null;
  const muted = { color: theme.textMuted, fontSize: type.micro } as const;

  return (
    <Card>
      <Row style={{ alignItems: 'flex-start' }}>
        <View style={{ flex: 1, paddingRight: space.sm }}>
          <Row style={{ justifyContent: 'flex-start', gap: space.sm }}>
            <View
              style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: color, marginTop: 5 }}
            />
            <Text style={{ color: theme.text, fontSize: type.bodyLg, fontWeight: '700', flex: 1 }}>
              {peer.router.alias || peer.router.identity}
            </Text>
          </Row>
          <Text style={{ ...muted, marginLeft: space.lg }}>
            {peer.tenant.name} · {peer.router.mode} · routeur {peer.router.health}
          </Text>
        </View>
        <Badge label={meta.label} tone={meta.tone} />
      </Row>

      <Text style={{ color: theme.text, fontSize: type.caption, fontWeight: '600' }}>
        {handshakeLine(peer)}
      </Text>
      <Text style={muted}>
        {peer.wgIp}:{peer.allocatedPort} · endpoint {peer.clientEndpoint ?? '—'}
      </Text>
      <Text style={muted}>
        ↓ {formatBytes(peer.rxBytes)} · ↑ {formatBytes(peer.txBytes)}
        {heartbeatAgeS != null ? ` · heartbeat il y a ${Math.round(heartbeatAgeS / 60)} min` : ' · aucun heartbeat'}
      </Text>

      {hint ? (
        <Text style={{ color: meta.tone === 'danger' ? theme.danger : theme.warning, fontSize: type.micro }}>
          {hint}
        </Text>
      ) : null}

      {peer.status !== 'REVOKED' ? (
        <Row style={{ gap: space.sm, marginTop: space.xs }}>
          {peer.status === 'ACTIVE' ? (
            <View style={{ flex: 1 }}>
              <Button title="Resync" variant="ghost" onPress={() => onResync(peer)} />
            </View>
          ) : null}
          <View style={{ flex: 1 }}>
            <Button title="Revoke" variant="danger" onPress={() => onRevoke(peer)} />
          </View>
        </Row>
      ) : null}
    </Card>
  );
});

function RevokeDialog({
  peer,
  busy,
  onConfirm,
  onCancel,
}: {
  peer: WgPeerRow | null;
  busy: boolean;
  onConfirm: (reason: string, confirmName: string) => void;
  onCancel: () => void;
}) {
  const theme = useTheme();
  const [reason, setReason] = useState('');
  const [typed, setTyped] = useState('');
  const name = peer ? peer.router.alias || peer.router.identity : '';
  const ready =
    peer !== null &&
    reason.trim().length >= 3 &&
    revokeConfirmed(typed, peer.router.alias, peer.router.identity);

  const close = () => {
    setReason('');
    setTyped('');
    onCancel();
  };

  return (
    <Modal visible={peer !== null} transparent animationType="fade" onRequestClose={close}>
      <View
        style={{
          flex: 1,
          backgroundColor: withAlpha(theme.bg, 0.95),
          justifyContent: 'center',
          padding: space.xxl,
        }}
      >
        <Card style={{ gap: space.md }}>
          <Title>Révoquer le tunnel</Title>
          <Banner tone="warning">
            {`L'accès distant de « ${name} » sera coupé et le routeur repassera en LOCAL. Un nouveau provisioning se fait depuis l'app du propriétaire, sur le LAN du routeur.`}
          </Banner>
          <Field label="Motif" value={reason} onChangeText={setReason} maxLength={200} placeholder="Ex. tunnel jamais établi" />
          <Field
            label={`Tapez « ${name} » pour confirmer`}
            value={typed}
            onChangeText={setTyped}
            autoCapitalize="none"
            autoCorrect={false}
          />
          <Row style={{ gap: space.sm }}>
            <View style={{ flex: 1 }}>
              <Button title="Annuler" variant="ghost" onPress={close} />
            </View>
            <View style={{ flex: 1 }}>
              <Button
                title="Révoquer"
                variant="danger"
                disabled={!ready}
                loading={busy}
                onPress={() => onConfirm(reason.trim(), typed.trim())}
              />
            </View>
          </Row>
        </Card>
      </View>
    </Modal>
  );
}

export function AdminWireGuardTab() {
  const theme = useTheme();
  const toast = useToast();
  const qc = useQueryClient();
  const [filter, setFilter] = useState<WgPeerState | null>(null);
  const [search, setSearch] = useState('');
  const [resyncTarget, setResyncTarget] = useState<WgPeerRow | null>(null);
  const [revokeTarget, setRevokeTarget] = useState<WgPeerRow | null>(null);

  const q = search.trim().length >= 3 ? search.trim() : undefined;

  const query = useQuery({
    queryKey: ['admin', 'wireguard', filter, q],
    queryFn: () => api.admin.wgPeers({ state: filter ?? undefined, q, limit: 200 }),
    refetchInterval: REFRESH_MS,
    placeholderData: keepPreviousData,
  });

  const refreshAll = () =>
    Promise.all([
      qc.invalidateQueries({ queryKey: ['admin', 'wireguard'] }),
      qc.invalidateQueries({ queryKey: ['admin', 'fleet'] }),
    ]);

  const resync = useMutation({
    mutationFn: (p: WgPeerRow) => api.admin.wgResync(p.router.id),
    onSuccess: async () => {
      toast.success('Peer resynchronisé');
      setResyncTarget(null);
      await refreshAll();
    },
    onError: (e) => {
      toast.error(describeError(e).message);
      setResyncTarget(null);
    },
  });

  const revoke = useMutation({
    mutationFn: (v: { peer: WgPeerRow; reason: string; confirmName: string }) =>
      api.admin.wgRevoke(v.peer.router.id, { reason: v.reason, confirmName: v.confirmName }),
    onSuccess: async (res) => {
      toast.success(res.wgRemoved ? 'Tunnel révoqué' : 'Révoqué en base — retrait WireGuard à vérifier');
      setRevokeTarget(null);
      await refreshAll();
    },
    onError: (e) => toast.error(describeError(e).message),
  });

  if (query.isLoading) {
    return (
      <View style={{ gap: space.md }}>
        <SkeletonCard />
        <SkeletonCard />
      </View>
    );
  }
  if (query.isError || !query.data) {
    return (
      <ErrorState
        message={describeError(query.error).message}
        onRetry={() => query.refetch()}
        retrying={query.isFetching}
      />
    );
  }

  const { items, summary } = query.data;
  const showDrift = summary.liveAvailable && (summary.drift.liveNotInDb > 0 || summary.drift.dbActiveNotLive > 0);

  return (
    <View style={{ gap: space.md }}>
      {!summary.wgEnabled ? (
        <Banner tone="warning">{"WireGuard est désactivé sur ce serveur : aucun état de tunnel n'est disponible."}</Banner>
      ) : !summary.liveAvailable ? (
        <Banner tone="warning">{"Lecture WireGuard indisponible : l'état réel des tunnels n'est pas connu."}</Banner>
      ) : null}
      {showDrift ? (
        <Banner tone="warning">
          {`Écart serveur/base : ${summary.drift.liveNotInDb} peer(s) dans wg hors base, ${summary.drift.dbActiveNotLive} peer(s) actif(s) en base absent(s) de wg. Le reconciler corrige au prochain cycle ; sinon, Resync.`}
        </Banner>
      ) : null}

      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginHorizontal: -space.lg }}>
        <Row style={{ gap: space.sm, paddingHorizontal: space.lg }}>
          {FILTERS.map((f) => {
            const active = filter === f.key;
            return (
              <Press
                key={f.label}
                accessibilityRole="button"
                accessibilityLabel={`${f.label}, ${f.count(summary)}`}
                onPress={() => setFilter(f.key)}
                style={{
                  backgroundColor: active ? withAlpha(theme.primary, 0.1) : theme.surfaceAlt,
                  borderRadius: radius.md,
                  paddingVertical: space.sm,
                  paddingHorizontal: space.md,
                }}
              >
                <Text
                  style={{
                    color: active ? theme.primary : theme.textMuted,
                    fontSize: type.micro,
                    fontWeight: '700',
                  }}
                >
                  {f.label} {f.count(summary)}
                </Text>
              </Press>
            );
          })}
        </Row>
      </ScrollView>

      <Field
        label="Rechercher"
        value={search}
        onChangeText={setSearch}
        placeholder="Routeur, tenant..."
        autoCapitalize="none"
        autoCorrect={false}
        hint={search.length > 0 && search.trim().length < 3 ? '3 caractères minimum' : undefined}
      />

      {!items.length ? (
        <Empty icon="git-network-outline" text="Aucun peer WireGuard" />
      ) : (
        items.map((p) => <PeerCard key={p.id} peer={p} onResync={setResyncTarget} onRevoke={setRevokeTarget} />)
      )}

      <ConfirmDialog
        visible={resyncTarget !== null}
        icon="sync-outline"
        tone="primary"
        title="Resynchroniser le peer"
        message={`Ré-appliquer le peer et les redirections de ${resyncTarget?.router.alias || resyncTarget?.router.identity} sur le serveur ?\nLa clé est conservée, le routeur n'est pas modifié.`}
        confirmLabel="Resync"
        busy={resync.isPending}
        onConfirm={() => resyncTarget && resync.mutate(resyncTarget)}
        onCancel={() => setResyncTarget(null)}
      />

      <RevokeDialog
        key={revokeTarget?.id ?? 'none'}
        peer={revokeTarget}
        busy={revoke.isPending}
        onConfirm={(reason, confirmName) =>
          revokeTarget && revoke.mutate({ peer: revokeTarget, reason, confirmName })
        }
        onCancel={() => setRevokeTarget(null)}
      />
    </View>
  );
}
