import { useState } from 'react';
import { ScrollView, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { keepPreviousData, useInfiniteQuery } from '@tanstack/react-query';
import { api, type AuditEntry, type EventCategory, type EventOutcome } from '@/src/lib/api';
import { describeError } from '@/src/lib/errors';
import {
  type Tone,
  Badge,
  Button,
  Card,
  Empty,
  ErrorState,
  Press,
  Row,
  SectionTitle,
  Skeleton,
  space,
  withAlpha,
} from '@/src/components/ui';
import { useTheme } from '@/src/providers/theme-provider';

const AUDIT_ACTION_COLORS: Record<string, string> = {
  CREATE: '#22c55e', ACTIVATE: '#22c55e', RESTORE: '#22c55e',
  UPDATE: '#3b82f6', SYNC: '#3b82f6', PUSH: '#3b82f6',
  DELETE: '#ef4444', SUSPEND: '#ef4444', REJECT: '#ef4444',
  REBOOT: '#f59e0b', GENERATE: '#8b5cf6',
};

const ENTITY_ICONS: Record<string, keyof typeof Ionicons.glyphMap> = {
  Router: 'hardware-chip-outline',
  RemotePeer: 'hardware-chip-outline',
  Voucher: 'ticket-outline',
  VoucherBatch: 'layers-outline',
  TicketVault: 'archive-outline',
  Plan: 'pricetags-outline',
  Tenant: 'business-outline',
  User: 'person-outline',
  PlatformConfig: 'settings-outline',
  Diagnostic: 'pulse-outline',
  Invoice: 'receipt-outline',
  PaymentProof: 'image-outline',
  Subscription: 'card-outline',
  SupportTicket: 'chatbubbles-outline',
};

const AUDIT_CATEGORIES: { key: EventCategory; label: string; icon: keyof typeof Ionicons.glyphMap }[] = [
  { key: 'TICKETS', label: 'Tickets', icon: 'ticket-outline' },
  { key: 'VAULT', label: 'Coffre', icon: 'archive-outline' },
  { key: 'ROUTERS', label: 'Routeurs', icon: 'hardware-chip-outline' },
  { key: 'DIAGNOSTICS', label: 'Diagnostics', icon: 'pulse-outline' },
  { key: 'PAYMENTS', label: 'Paiements', icon: 'card-outline' },
  { key: 'SUPPORT', label: 'Support', icon: 'chatbubbles-outline' },
];

const AUDIT_OUTCOMES: { key: EventOutcome; label: string; tone: Tone }[] = [
  { key: 'SUCCESS', label: 'Succès', tone: 'success' },
  { key: 'WARNING', label: 'Attention', tone: 'warning' },
  { key: 'PARTIAL_SUCCESS', label: 'Partiel', tone: 'warning' },
  { key: 'FAILED', label: 'Échec', tone: 'danger' },
];

function outcomeMeta(outcome: EventOutcome): { label: string; tone: Tone } {
  const m = AUDIT_OUTCOMES.find((o) => o.key === outcome);
  return m ?? { label: outcome, tone: 'muted' };
}

function metaString(meta: unknown, key: string): string | null {
  if (meta && typeof meta === 'object' && key in meta) {
    const v = (meta as Record<string, unknown>)[key];
    return typeof v === 'string' && v ? v : null;
  }
  return null;
}

function fmtAuditTime(iso: string): string {
  const d = new Date(iso);
  const diff = Date.now() - d.getTime();
  if (diff < 60_000) return "À l'instant";
  if (diff < 3600_000) return `Il y a ${Math.floor(diff / 60_000)} min`;
  if (diff < 86400_000) return `Il y a ${Math.floor(diff / 3600_000)}h`;
  return d.toLocaleDateString('fr-FR', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
}

function FilterChip({
  label,
  active,
  onPress,
  icon,
}: {
  label: string;
  active: boolean;
  onPress: () => void;
  icon?: keyof typeof Ionicons.glyphMap;
}) {
  const theme = useTheme();
  return (
    <Press
      accessibilityRole="button"
      accessibilityLabel={active ? `${label}, sélectionné` : label}
      onPress={onPress}
      style={{
        paddingVertical: 6,
        paddingHorizontal: 12,
        borderRadius: 10,
        backgroundColor: active ? theme.primary : theme.surface,
        flexDirection: 'row',
        alignItems: 'center',
        gap: 4,
      }}
    >
      {icon ? <Ionicons name={icon} size={12} color={active ? theme.primaryText : theme.textMuted} /> : null}
      <Text style={{ color: active ? theme.primaryText : theme.textMuted, fontSize: 11, fontWeight: '700' }}>
        {label}
      </Text>
    </Press>
  );
}

export function AdminAuditTab() {
  const theme = useTheme();
  const [category, setCategory] = useState<EventCategory | null>(null);
  const [outcome, setOutcome] = useState<EventOutcome | null>(null);

  const auditQuery = useInfiniteQuery({
    queryKey: ['admin-audit', category, outcome],
    queryFn: ({ pageParam }) =>
      api.admin.audit({
        limit: 30,
        ...(category ? { category } : {}),
        ...(outcome ? { outcome } : {}),
        ...(pageParam ? { cursor: pageParam } : {}),
      }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    placeholderData: keepPreviousData,
  });

  const entries = auditQuery.data?.pages.flatMap((p) => p.items) ?? [];

  return (
    <View style={{ gap: 14 }}>
      <SectionTitle>Audit Center</SectionTitle>

      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginHorizontal: -space.lg }}>
        <View style={{ flexDirection: 'row', gap: 6, paddingHorizontal: space.lg }}>
          <FilterChip label="Tout" active={!category} onPress={() => setCategory(null)} />
          {AUDIT_CATEGORIES.map((c) => (
            <FilterChip
              key={c.key}
              label={c.label}
              icon={c.icon}
              active={category === c.key}
              onPress={() => setCategory(category === c.key ? null : c.key)}
            />
          ))}
        </View>
      </ScrollView>

      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginHorizontal: -space.lg }}>
        <View style={{ flexDirection: 'row', gap: 6, paddingHorizontal: space.lg }}>
          <FilterChip label="Tous résultats" active={!outcome} onPress={() => setOutcome(null)} />
          {AUDIT_OUTCOMES.map((o) => (
            <FilterChip
              key={o.key}
              label={o.label}
              active={outcome === o.key}
              onPress={() => setOutcome(outcome === o.key ? null : o.key)}
            />
          ))}
        </View>
      </ScrollView>

      {auditQuery.isLoading ? (
        <View style={{ gap: 8 }}>
          {[0, 1, 2, 3, 4].map((i) => <Skeleton key={i} height={60} radius={12} />)}
        </View>
      ) : auditQuery.isError ? (
        <ErrorState message={describeError(auditQuery.error).message} onRetry={() => auditQuery.refetch()} />
      ) : !entries.length ? (
        <Empty icon="receipt-outline" text="Aucun événement." />
      ) : (
        <View style={{ gap: 6 }}>
          {entries.map((entry: AuditEntry) => {
            const errCode = metaString(entry.metadata, 'errorCode');
            const errMessage = metaString(entry.metadata, 'error');
            const actionColor = AUDIT_ACTION_COLORS[entry.action] ?? theme.textMuted;
            const result = outcomeMeta(entry.outcome);
            const failed = entry.outcome === 'FAILED';
            return (
              <Card key={entry.id} style={{ gap: 6, paddingVertical: 10, paddingHorizontal: 12 }}>
                <Row>
                  <Row style={{ gap: 8, flex: 1, justifyContent: 'flex-start' }}>
                    <View style={{
                      width: 30, height: 30, borderRadius: 9,
                      backgroundColor: withAlpha(actionColor, 0.1),
                      alignItems: 'center', justifyContent: 'center',
                    }}>
                      <Ionicons
                        name={ENTITY_ICONS[entry.entityType] ?? 'ellipse-outline'}
                        size={14}
                        color={actionColor}
                      />
                    </View>
                    <View style={{ flex: 1 }}>
                      <Row style={{ gap: 6, justifyContent: 'flex-start' }}>
                        <Badge label={result.label} tone={result.tone} />
                        <Text style={{ color: theme.text, fontSize: 11, fontWeight: '700' }}>{entry.action}</Text>
                        <Text style={{ color: theme.textMuted, fontSize: 10 }} numberOfLines={1}>
                          {entry.entityType}
                        </Text>
                      </Row>
                      <Text style={{ color: theme.text, fontSize: 12, fontWeight: '600', marginTop: 2 }} numberOfLines={1}>
                        {entry.tenantName}
                        {entry.userName ? ` · ${entry.userName}` : ''}
                      </Text>
                    </View>
                  </Row>
                  <Text style={{ color: theme.textMuted, fontSize: 10 }}>
                    {fmtAuditTime(entry.createdAt)}
                  </Text>
                </Row>

                {errCode ? (
                  <Row style={{ gap: 6, justifyContent: 'flex-start', marginTop: 2 }}>
                    <Ionicons name="warning-outline" size={12} color={failed ? theme.danger : theme.warning} />
                    <Text
                      style={{ color: failed ? theme.danger : theme.warning, fontSize: 10, fontWeight: '700', fontFamily: 'monospace' }}
                    >
                      {errCode}
                    </Text>
                  </Row>
                ) : null}
                {errMessage ? (
                  <Text style={{ color: theme.textMuted, fontSize: 11 }} numberOfLines={3}>
                    {errMessage}
                  </Text>
                ) : null}

                {entry.entityId ? (
                  <Text style={{ color: theme.textMuted, fontSize: 9, fontFamily: 'monospace' }} numberOfLines={1}>
                    {entry.entityId}
                  </Text>
                ) : null}
              </Card>
            );
          })}
          {auditQuery.hasNextPage ? (
            <Button
              title="Charger plus"
              variant="ghost"
              loading={auditQuery.isFetchingNextPage}
              onPress={() => auditQuery.fetchNextPage()}
            />
          ) : null}
        </View>
      )}
    </View>
  );
}
