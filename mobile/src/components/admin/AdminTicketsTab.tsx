import { memo, useCallback, useState } from 'react';
import { FlatList, Modal, Text, TextInput, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { keepPreviousData, useMutation, useQuery } from '@tanstack/react-query';
import { api } from '@/src/lib/api';
import { describeError } from '@/src/lib/errors';
import { shortDate } from '@/src/lib/format';
import {
  Badge,
  Card,
  Empty,
  ErrorState,
  Press,
  Row,
  SectionTitle,
  SkeletonCard,
  space,
  Title,
  type,
  useToast,
  withAlpha,
  radius,
} from '@/src/components/ui';
import { useTheme } from '@/src/providers/theme-provider';

const TICKET_STATUSES = ['OPEN', 'IN_PROGRESS', 'RESOLVED', 'CLOSED'] as const;

const TicketStatusButtons = memo(function TicketStatusButtons({
  ticketId,
  currentStatus,
  onSetStatus,
}: {
  ticketId: string;
  currentStatus: string;
  onSetStatus: (id: string, status: (typeof TICKET_STATUSES)[number]) => void;
}) {
  const theme = useTheme();
  return (
    <Row style={{ gap: space.sm, marginTop: space.sm, flexWrap: 'wrap' }}>
      {TICKET_STATUSES.filter((s) => s !== currentStatus).map((s) => (
        <Press
          key={s}
          onPress={() => onSetStatus(ticketId, s)}
          style={{
            paddingHorizontal: 10,
            paddingVertical: 4,
            borderRadius: radius.pill,
            backgroundColor: theme.surfaceAlt,
          }}
        >
          <Text style={{ color: theme.textMuted, fontSize: 10, fontWeight: '600' }}>{s}</Text>
        </Press>
      ))}
    </Row>
  );
});

/** Onglet SAV du back-office admin — extrait de admin.tsx, aucun état partagé avec le reste de l'écran. */
export function AdminTicketsTab() {
  const theme = useTheme();
  const { t } = useTranslation();
  const toast = useToast();
  const [selectedTicketId, setSelectedTicketId] = useState<string | null>(null);
  const [replyText, setReplyText] = useState('');

  const ticketsQuery = useQuery({
    queryKey: ['admin-tickets'],
    queryFn: () => api.admin.listTickets(),
    placeholderData: keepPreviousData,
  });

  const ticketDetailQuery = useQuery({
    queryKey: ['admin-ticket', selectedTicketId],
    queryFn: () => api.admin.getTicket(selectedTicketId!),
    enabled: !!selectedTicketId,
  });

  const statusMutation = useMutation({
    mutationFn: ({ id, status }: { id: string; status: 'OPEN' | 'IN_PROGRESS' | 'RESOLVED' | 'CLOSED' }) =>
      api.admin.setTicketStatus(id, status),
    onSuccess: () => {
      ticketsQuery.refetch();
      if (selectedTicketId) ticketDetailQuery.refetch();
      toast.success(t('admin.statusUpdated'));
    },
    onError: (e) => toast.error(describeError(e).message),
  });

  const handleSetStatus = useCallback(
    (id: string, status: (typeof TICKET_STATUSES)[number]) => statusMutation.mutate({ id, status }),
    [statusMutation],
  );

  const replyMutation = useMutation({
    mutationFn: (body: string) => api.admin.replyToTicket(selectedTicketId!, body),
    onSuccess: () => {
      setReplyText('');
      ticketDetailQuery.refetch();
      ticketsQuery.refetch();
    },
    onError: (e) => toast.error(describeError(e).message),
  });

  if (ticketsQuery.isLoading) return <SkeletonCard />;
  if (ticketsQuery.isError) return <ErrorState message={describeError(ticketsQuery.error).message} onRetry={() => ticketsQuery.refetch()} retrying={ticketsQuery.isFetching} />;

  const tickets = ticketsQuery.data?.items ?? [];

  if (!tickets.length) return <Empty icon="chatbubbles-outline" text={t('admin.noSavTickets')} />;

  return (
    <View style={{ gap: space.md }}>
      <SectionTitle>{t('admin.savTickets')}</SectionTitle>
      {tickets.map((tk: any) => (
        <Press key={tk.id} onPress={() => { setSelectedTicketId(tk.id); setReplyText(''); }}>
          <Card>
            <Row style={{ justifyContent: 'space-between', marginBottom: 6 }}>
              <Text numberOfLines={1} style={{ color: theme.text, fontWeight: '700', fontSize: type.body, flex: 1, marginRight: space.sm }}>
                {tk.subject}
              </Text>
              <Badge label={tk.status} tone={tk.status === 'OPEN' ? 'primary' : tk.status === 'RESOLVED' ? 'success' : 'muted'} />
            </Row>
            <Text style={{ color: theme.textMuted, fontSize: type.caption }}>
              {tk.tenantName} — {shortDate(tk.createdAt)} — {tk._count?.messages ?? 0} msg
            </Text>
            <TicketStatusButtons
              ticketId={tk.id}
              currentStatus={tk.status}
              onSetStatus={handleSetStatus}
            />
          </Card>
        </Press>
      ))}

      <Modal visible={!!selectedTicketId} animationType="slide" transparent>
        <View style={{ flex: 1, backgroundColor: withAlpha(theme.bg, 0.98), paddingTop: space.xxl }}>
          <Row style={{ justifyContent: 'space-between', paddingHorizontal: space.lg, paddingVertical: space.md }}>
            <Title>{ticketDetailQuery.data?.subject ?? t('admin.savTickets')}</Title>
            <Press onPress={() => setSelectedTicketId(null)}>
              <Ionicons name="close" size={24} color={theme.text} />
            </Press>
          </Row>

          {ticketDetailQuery.isLoading ? (
            <SkeletonCard />
          ) : ticketDetailQuery.data ? (
            <FlatList
              data={ticketDetailQuery.data.messages}
              keyExtractor={(m) => m.id}
              initialNumToRender={15}
              maxToRenderPerBatch={15}
              windowSize={7}
              contentContainerStyle={{ padding: space.lg, gap: space.sm }}
              renderItem={({ item: msg }) => (
                <View
                  style={{
                    alignSelf: msg.isAdmin ? 'flex-end' : 'flex-start',
                    maxWidth: '80%',
                    backgroundColor: msg.isAdmin ? theme.primary : theme.surface,
                    borderRadius: radius.lg,
                    padding: space.md,
                  }}
                >
                  <Text style={{ color: msg.isAdmin ? '#fff' : theme.text, fontSize: type.body }}>
                    {msg.body}
                  </Text>
                  <Text style={{ color: msg.isAdmin ? 'rgba(255,255,255,0.6)' : theme.textMuted, fontSize: type.micro, marginTop: 2 }}>
                    {msg.user?.name ?? 'Admin'} — {shortDate(msg.createdAt)}
                  </Text>
                </View>
              )}
            />
          ) : null}

          <View style={{ flexDirection: 'row', gap: space.sm, padding: space.lg, alignItems: 'flex-end' }}>
            <TextInput
              value={replyText}
              onChangeText={setReplyText}
              placeholder={t('admin.replyPlaceholder')}
              placeholderTextColor={theme.textMuted}
              multiline
              style={{
                flex: 1,
                backgroundColor: theme.surface,
                borderRadius: radius.lg,
                padding: space.md,
                color: theme.text,
                fontSize: type.body,
                maxHeight: 120,
              }}
            />
            <Press
              onPress={() => { if (replyText.trim()) replyMutation.mutate(replyText.trim()); }}
              disabled={!replyText.trim() || replyMutation.isPending}
              style={{
                width: 44,
                height: 44,
                borderRadius: 22,
                backgroundColor: theme.primary,
                alignItems: 'center',
                justifyContent: 'center',
                opacity: replyText.trim() ? 1 : 0.4,
              }}
            >
              <Ionicons name="send" size={20} color="#fff" />
            </Press>
          </View>
        </View>
      </Modal>
    </View>
  );
}
