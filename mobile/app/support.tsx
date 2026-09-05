import { useState } from 'react';
import {
  FlatList,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  TextInput,
  View,
  Text,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api, type SupportTicketSummary, type SupportTicketDetail, type TicketMessage } from '@/src/lib/api';
import { describeError } from '@/src/lib/errors';
import {
  Button,
  ErrorState,
  FadeIn,
  Press,
  radius,
  Row,
  space,
  Skeleton,
  Title,
  type,
  useToast,
} from '@/src/components/ui';
import { useTheme } from '@/src/providers/theme-provider';
import { AppHeader } from '@/src/components/AppHeader';
import { BottomNav, useBottomNavHeight } from '@/src/components/BottomNav';

function StatusBadge({ status }: { status: string }) {
  const theme = useTheme();
  const { t } = useTranslation();
  const statusColors: Record<string, string> = {
    OPEN: theme.primary,
    IN_PROGRESS: theme.gold,
    RESOLVED: theme.success,
    CLOSED: theme.textMuted,
  };
  const color = statusColors[status] ?? theme.textMuted;
  const labels: Record<string, string> = {
    OPEN: t('support.statusOpen'),
    IN_PROGRESS: t('support.statusInProgress'),
    RESOLVED: t('support.statusResolved'),
    CLOSED: t('support.statusClosed'),
  };
  return (
    <View
      style={{
        backgroundColor: color + '22',
        borderRadius: radius.pill,
        paddingHorizontal: 10,
        paddingVertical: 3,
      }}
    >
      <Text style={{ color, fontSize: 10, fontWeight: '700' }}>
        {labels[status] ?? status}
      </Text>
    </View>
  );
}

function TicketRow({
  ticket,
  onPress,
}: {
  ticket: SupportTicketSummary;
  onPress: () => void;
}) {
  const theme = useTheme();
  return (
    <Press
      accessibilityRole="button"
      accessibilityLabel={`Ticket ${ticket.subject}`}
      onPress={onPress}
      style={{
        backgroundColor: theme.surface,
        borderRadius: radius.md,
        padding: space.lg,
      }}
    >
      <Row style={{ justifyContent: 'space-between', marginBottom: 6 }}>
        <Text
          numberOfLines={1}
          style={{
            color: theme.text,
            fontSize: type.body,
            fontWeight: '700',
            flex: 1,
            marginRight: space.sm,
          }}
        >
          {ticket.subject}
        </Text>
        <StatusBadge status={ticket.status} />
      </Row>
      <Row style={{ justifyContent: 'space-between' }}>
        <Text style={{ color: theme.textMuted, fontSize: type.caption }}>
          {new Date(ticket.createdAt).toLocaleDateString('fr-FR')}
        </Text>
        <Row style={{ gap: 4 }}>
          <Ionicons name="chatbubble-outline" size={12} color={theme.textMuted} />
          <Text style={{ color: theme.textMuted, fontSize: type.caption }}>
            {ticket._count.messages}
          </Text>
        </Row>
      </Row>
    </Press>
  );
}

function MessageBubble({ msg }: { msg: TicketMessage }) {
  const theme = useTheme();
  const isAdmin = msg.isAdmin;
  return (
    <View
      style={{
        alignSelf: isAdmin ? 'flex-start' : 'flex-end',
        maxWidth: '80%',
        marginBottom: space.sm,
      }}
    >
      <View
        style={{
          backgroundColor: isAdmin ? theme.surface : theme.primary,
          borderRadius: radius.md,
          borderTopLeftRadius: isAdmin ? 4 : radius.md,
          borderTopRightRadius: isAdmin ? radius.md : 4,
          padding: space.md,
        }}
      >
        {isAdmin ? (
          <Text style={{ color: theme.primary, fontSize: 10, fontWeight: '700', marginBottom: 4 }}>
            Support
          </Text>
        ) : null}
        <Text style={{ color: isAdmin ? theme.text : theme.primaryText, fontSize: type.body }}>
          {msg.body}
        </Text>
      </View>
      <Text
        style={{
          color: theme.textMuted,
          fontSize: 9,
          marginTop: 2,
          textAlign: isAdmin ? 'left' : 'right',
        }}
      >
        {new Date(msg.createdAt).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}
      </Text>
    </View>
  );
}

function TicketDetail({
  ticketId,
  onBack,
}: {
  ticketId: string;
  onBack: () => void;

}) {
  const theme = useTheme();
  const { t } = useTranslation();
  const qc = useQueryClient();
  const toast = useToast();
  const [body, setBody] = useState('');

  const query = useQuery({
    queryKey: ['support-ticket', ticketId],
    queryFn: () => api.support.getTicket(ticketId),
  });

  const sendMutation = useMutation({
    mutationFn: () => api.support.addMessage(ticketId, body.trim()),
    onSuccess: () => {
      setBody('');
      qc.invalidateQueries({ queryKey: ['support-ticket', ticketId] });
      qc.invalidateQueries({ queryKey: ['support-tickets'] });
    },
    onError: (e) => toast.error(describeError(e).message),
  });

  const ticket = query.data;

  return (
    <KeyboardAvoidingView
      style={{ flex: 1 }}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <AppHeader title={ticket?.subject ?? 'Ticket'} back />
      {query.isLoading ? (
        <View style={{ padding: space.lg, gap: space.md }}>
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} height={60} radius={radius.md} />
          ))}
        </View>
      ) : query.isError ? (
        <ErrorState
          message={describeError(query.error).message}
          onRetry={() => query.refetch()}
          retrying={query.isFetching}
        />
      ) : (
        <>
          <FlatList
            data={ticket?.messages ?? []}
            keyExtractor={(m) => m.id}
            renderItem={({ item }) => <MessageBubble msg={item} />}
            contentContainerStyle={{
              padding: space.lg,
              paddingBottom: space.xxl,
            }}
            inverted={false}
          />
          {ticket?.status !== 'CLOSED' ? (
            <View
              style={{
                flexDirection: 'row',
                gap: space.sm,
                padding: space.md,
                borderTopWidth: 1,
                borderTopColor: theme.border,
                backgroundColor: theme.bg,
              }}
            >
              <TextInput
                value={body}
                onChangeText={setBody}
                placeholder={t('support.yourMessage')}
                placeholderTextColor={theme.textMuted}
                multiline
                style={{
                  flex: 1,
                  backgroundColor: theme.surface,
                  borderRadius: radius.md,
                  padding: space.md,
                  color: theme.text,
                  fontSize: type.body,
                  maxHeight: 100,
                }}
              />
              <Press
                accessibilityLabel={t('common.send')}
                onPress={() => {
                  if (body.trim()) sendMutation.mutate();
                }}
                disabled={!body.trim() || sendMutation.isPending}
                style={{
                  width: 44,
                  height: 44,
                  borderRadius: radius.md,
                  backgroundColor: body.trim() ? theme.primary : theme.border,
                  alignItems: 'center',
                  justifyContent: 'center',
                  alignSelf: 'flex-end',
                }}
              >
                <Ionicons
                  name="send"
                  size={20}
                  color={body.trim() ? theme.primaryText : theme.textMuted}
                />
              </Press>
            </View>
          ) : null}
        </>
      )}
    </KeyboardAvoidingView>
  );
}

function CreateTicketForm({ onCreated }: { onCreated: (id: string) => void }) {
  const theme = useTheme();
  const { t } = useTranslation();
  const toast = useToast();
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit() {
    if (!subject.trim() || !body.trim()) return;
    setBusy(true);
    try {
      const ticket = await api.support.createTicket(subject.trim(), body.trim());
      toast.success(t('support.ticketCreated'));
      onCreated(ticket.id);
    } catch (e) {
      toast.error(describeError(e).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <ScrollView
      contentContainerStyle={{ padding: space.lg, gap: space.lg }}
    >
      <Title>{t('support.newTicketTitle')}</Title>
      <View style={{ gap: space.sm }}>
        <Text style={{ color: theme.text, fontWeight: '600', fontSize: type.body }}>
          {t('support.subject')}
        </Text>
        <TextInput
          value={subject}
          onChangeText={setSubject}
          placeholder={t('support.subjectPlaceholder')}
          placeholderTextColor={theme.textMuted}
          style={{
            backgroundColor: theme.surface,
            borderRadius: radius.md,
            padding: space.md,
            color: theme.text,
            fontSize: type.body,
            borderWidth: 1,
            borderColor: theme.border,
          }}
        />
      </View>
      <View style={{ gap: space.sm }}>
        <Text style={{ color: theme.text, fontWeight: '600', fontSize: type.body }}>
          {t('support.description')}
        </Text>
        <TextInput
          value={body}
          onChangeText={setBody}
          placeholder={t('support.descriptionPlaceholder')}
          placeholderTextColor={theme.textMuted}
          multiline
          numberOfLines={5}
          textAlignVertical="top"
          style={{
            backgroundColor: theme.surface,
            borderRadius: radius.md,
            padding: space.md,
            color: theme.text,
            fontSize: type.body,
            borderWidth: 1,
            borderColor: theme.border,
            minHeight: 120,
          }}
        />
      </View>
      <Button
        title={t('common.send')}
        variant="primary"
        onPress={submit}
        loading={busy}
        disabled={!subject.trim() || !body.trim()}
      />
    </ScrollView>
  );
}

export default function SupportScreen() {
  const theme = useTheme();
  const { t } = useTranslation();
  const navHeight = useBottomNavHeight();
  const qc = useQueryClient();
  const [view, setView] = useState<'list' | 'create' | { id: string }>('list');

  const ticketsQuery = useQuery({
    queryKey: ['support-tickets'],
    queryFn: () => api.support.listTickets(),
  });

  if (typeof view === 'object') {
    return (
      <View style={{ flex: 1, backgroundColor: theme.bg }}>
        <TicketDetail
          ticketId={view.id}
          onBack={() => {
            setView('list');
            qc.invalidateQueries({ queryKey: ['support-tickets'] });
          }}
        />
        <BottomNav />
      </View>
    );
  }

  if (view === 'create') {
    return (
      <View style={{ flex: 1, backgroundColor: theme.bg }}>
        <AppHeader title={t('support.title')} back />
        <CreateTicketForm
          onCreated={(id) => {
            qc.invalidateQueries({ queryKey: ['support-tickets'] });
            setView({ id });
          }}
        />
        <BottomNav />
      </View>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: theme.bg }}>
      <AppHeader title={t('support.title')} back />
      <FlatList
        data={ticketsQuery.data?.items ?? []}
        keyExtractor={(t) => t.id}
        renderItem={({ item }) => (
          <TicketRow ticket={item} onPress={() => setView({ id: item.id })} />
        )}
        contentContainerStyle={{
          padding: space.lg,
          gap: space.md,
          paddingBottom: navHeight,
        }}
        ListHeaderComponent={
          <FadeIn>
            <Row style={{ justifyContent: 'space-between', marginBottom: space.md }}>
              <Title>{t('support.myTickets')}</Title>
              <Button
                title={t('support.newTicket')}
                variant="primary"
                onPress={() => setView('create')}
              />
            </Row>
          </FadeIn>
        }
        ListEmptyComponent={
          ticketsQuery.isLoading ? (
            <View style={{ gap: space.md }}>
              {[0, 1, 2].map((i) => (
                <Skeleton key={i} height={80} radius={radius.md} />
              ))}
            </View>
          ) : ticketsQuery.isError ? (
            <ErrorState
              message={describeError(ticketsQuery.error).message}
              onRetry={() => ticketsQuery.refetch()}
              retrying={ticketsQuery.isFetching}
            />
          ) : (
            <FadeIn>
              <View style={{ alignItems: 'center', padding: space.xxl, gap: space.md }}>
                <Ionicons name="chatbubbles-outline" size={48} color={theme.textMuted} />
                <Text style={{ color: theme.textMuted, fontSize: type.body, textAlign: 'center' }}>
                  {t('support.noTicket')}
                </Text>
              </View>
            </FadeIn>
          )
        }
      />
      <BottomNav />
    </View>
  );
}
