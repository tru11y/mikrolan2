import { useState } from 'react';
import { Text, View } from 'react-native';
import { keepPreviousData, useMutation, useQuery } from '@tanstack/react-query';
import { api, type FleetRouter } from '@/src/lib/api';
import { describeError } from '@/src/lib/errors';
import {
  Badge,
  Button,
  Card,
  ConfirmDialog,
  Empty,
  ErrorState,
  FadeIn,
  Field,
  Press,
  radius,
  Row,
  SkeletonCard,
  space,
  type,
  useToast,
  withAlpha,
} from '@/src/components/ui';
import { useTheme } from '@/src/providers/theme-provider';

function healthColor(health: string, theme: any): string {
  if (health === 'ONLINE') return theme.success;
  if (health === 'OFFLINE') return theme.danger;
  return theme.gold;
}

export function AdminFleetTab() {
  const theme = useTheme();
  const toast = useToast();
  const [filter, setFilter] = useState<string | undefined>(undefined);
  const [search, setSearch] = useState('');
  const [diagRouter, setDiagRouter] = useState<FleetRouter | null>(null);
  const [confirmToken, setConfirmToken] = useState<string | null>(null);

  const q = search.trim().length >= 3 ? search.trim() : undefined;

  const query = useQuery({
    queryKey: ['admin', 'fleet', filter, q],
    queryFn: () => api.admin.fleet({ health: filter, q, limit: 50 }),
    placeholderData: keepPreviousData,
  });

  const enterDiag = useMutation({
    mutationFn: (r: FleetRouter) => api.admin.enterDiagnostic(r.tenant.id, r.id),
    onSuccess: (data) => {
      setConfirmToken(data.confirmToken);
      toast.success(`Mode diagnostic activé (${data.expiresInSeconds}s)`);
    },
    onError: (e) => toast.error(describeError(e).message),
  });

  const reboot = useMutation({
    mutationFn: () => {
      if (!diagRouter || !confirmToken) throw new Error('Missing context');
      return api.admin.confirmedReboot(diagRouter.tenant.id, diagRouter.id, confirmToken);
    },
    onSuccess: () => {
      toast.success('Routeur redémarré');
      setDiagRouter(null);
      setConfirmToken(null);
      query.refetch();
    },
    onError: (e) => toast.error(describeError(e).message),
  });

  if (query.isLoading) return <View style={{ gap: space.md }}><SkeletonCard /><SkeletonCard /></View>;
  if (query.isError) return <ErrorState message={describeError(query.error).message} onRetry={() => query.refetch()} retrying={query.isFetching} />;

  const items = query.data?.items ?? [];

  return (
    <View style={{ gap: space.md }}>
      <Row style={{ gap: space.sm }}>
        {[
          { key: undefined, label: 'Tous' },
          { key: 'ONLINE', label: 'En ligne' },
          { key: 'OFFLINE', label: 'Hors ligne' },
          { key: 'DEGRADED', label: 'Dégradé' },
        ].map((f) => (
          <Press
            key={f.key ?? 'all'}
            onPress={() => setFilter(f.key)}
            style={{
              flex: 1,
              backgroundColor: filter === f.key ? withAlpha(theme.primary, 0.1) : theme.surfaceAlt,
              borderRadius: radius.md,
              paddingVertical: space.sm,
              alignItems: 'center',
            }}
          >
            <Text style={{
              color: filter === f.key ? theme.primary : theme.textMuted,
              fontSize: type.micro,
              fontWeight: '700',
            }}>
              {f.label}
            </Text>
          </Press>
        ))}
      </Row>

      <Field
        label="Rechercher"
        value={search}
        onChangeText={setSearch}
        placeholder="Routeur, client..."
        autoCapitalize="none"
        autoCorrect={false}
        hint={search.length > 0 && search.trim().length < 3 ? '3 caractères minimum' : undefined}
      />

      {!items.length ? (
        <Empty icon="hardware-chip-outline" text="Aucun routeur trouvé" />
      ) : (
        items.map((r, i) => {
          const telem = r.telemetry?.[0];
          return (
            <FadeIn key={r.id} delay={i * 30}>
              <Card>
                <Row style={{ alignItems: 'flex-start' }}>
                  <View style={{ flex: 1, paddingRight: space.sm }}>
                    <Row style={{ justifyContent: 'flex-start', gap: space.sm }}>
                      <View style={{
                        width: 8, height: 8, borderRadius: 4,
                        backgroundColor: healthColor(r.health, theme),
                        marginTop: 5,
                      }} />
                      <Text style={{ color: theme.text, fontSize: type.bodyLg, fontWeight: '700' }}>
                        {r.alias || r.identity}
                      </Text>
                    </Row>
                    <Text style={{ color: theme.textMuted, fontSize: type.micro, marginLeft: space.lg }}>
                      {r.tenant.name} · {r.model ?? 'MikroTik'} · {r.mode}
                    </Text>
                  </View>
                  <Badge label={r.health} tone={r.health === 'ONLINE' ? 'success' : r.health === 'OFFLINE' ? 'danger' : 'gold'} />
                </Row>

                {telem ? (
                  <Row style={{ marginTop: space.sm, gap: space.md }}>
                    <Text style={{ color: theme.textMuted, fontSize: type.micro }}>
                      CPU {telem.cpuPercent}%
                    </Text>
                    <Text style={{ color: theme.textMuted, fontSize: type.micro }}>
                      RAM {telem.memoryPercent}%
                    </Text>
                    <Text style={{ color: theme.textMuted, fontSize: type.micro }}>
                      Up {Math.floor(telem.uptimeSeconds / 3600)}h
                    </Text>
                  </Row>
                ) : null}

                {r.lastSyncError ? (
                  <Text style={{ color: theme.danger, fontSize: type.micro, marginTop: 4 }}>
                    {r.lastSyncError} ({r.syncFailCount}x)
                  </Text>
                ) : null}

                <Row style={{ gap: space.sm, marginTop: space.sm }}>
                  <View style={{ flex: 1 }}>
                    <Button
                      title="Diagnostic"
                      variant="ghost"
                      onPress={() => { setDiagRouter(r); setConfirmToken(null); }}
                    />
                  </View>
                </Row>
              </Card>
            </FadeIn>
          );
        })
      )}

      <ConfirmDialog
        visible={diagRouter !== null && confirmToken === null}
        icon="medical-outline"
        tone="primary"
        title="Mode diagnostic"
        message={`Entrer en mode diagnostic pour ${diagRouter?.alias || diagRouter?.identity} ?\nCette session expire après 5 minutes.`}
        confirmLabel="Activer"
        busy={enterDiag.isPending}
        onConfirm={() => diagRouter && enterDiag.mutate(diagRouter)}
        onCancel={() => setDiagRouter(null)}
      />

      <ConfirmDialog
        visible={diagRouter !== null && confirmToken !== null}
        icon="reload-outline"
        tone="danger"
        title="Confirmer le redémarrage"
        message={`Redémarrer ${diagRouter?.alias || diagRouter?.identity} ?\nLe routeur sera indisponible ~30 secondes.`}
        confirmLabel="Redémarrer"
        busy={reboot.isPending}
        onConfirm={() => reboot.mutate()}
        onCancel={() => { setDiagRouter(null); setConfirmToken(null); }}
      />
    </View>
  );
}
