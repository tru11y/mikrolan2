'use client';

import { useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiGet, apiPost, extractErrorMessage } from '@/lib/api';
import { Badge, Button, Card, EmptyState, ErrorBox, Input, Loading, PageHeader } from '@/components/ui';
import { dateFr } from '@/lib/format';

type Page<T> = { items: T[]; nextCursor: string | null };

type TicketMessage = {
  id: string;
  body: string;
  isAdmin: boolean;
  createdAt: string;
  user: { id: string; name: string | null };
};

type TicketSummary = {
  id: string;
  subject: string;
  status: string;
  priority: string;
  createdAt: string;
  updatedAt: string;
  _count: { messages: number };
};

type TicketDetail = {
  id: string;
  subject: string;
  status: string;
  priority: string;
  createdAt: string;
  messages: TicketMessage[];
};

function statusTone(status: string): 'success' | 'warning' | 'muted' | 'primary' {
  const s = status.toUpperCase();
  if (s === 'CLOSED' || s === 'RESOLVED') return 'success';
  if (s === 'OPEN' || s === 'PENDING') return 'warning';
  if (s === 'IN_PROGRESS' || s === 'ANSWERED') return 'primary';
  return 'muted';
}

export default function SupportPage() {
  const qc = useQueryClient();
  const [selected, setSelected] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  const contact = useQuery({
    queryKey: ['support', 'contact'],
    queryFn: () => apiGet<{ whatsapp: string | null }>('/support/contact'),
  });

  const tickets = useQuery({
    queryKey: ['support', 'tickets'],
    queryFn: () => apiGet<Page<TicketSummary>>('/support/tickets', { limit: 50 }),
  });

  return (
    <div>
      <PageHeader
        title="Support"
        action={
          <Button onClick={() => { setCreating(true); setSelected(null); }}>Nouveau ticket</Button>
        }
      />

      {contact.data?.whatsapp && (
        <Card className="mb-4">
          <div className="text-sm text-muted">Contact direct</div>
          <a
            href={`https://wa.me/${contact.data.whatsapp.replace(/[^0-9]/g, '')}`}
            target="_blank"
            rel="noopener noreferrer"
            className="font-medium text-primary hover:underline"
          >
            WhatsApp : {contact.data.whatsapp}
          </a>
        </Card>
      )}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[320px_1fr]">
        <div>
          {tickets.isLoading ? (
            <Loading />
          ) : tickets.error ? (
            <ErrorBox message={extractErrorMessage(tickets.error)} />
          ) : (tickets.data?.items ?? []).length === 0 ? (
            <EmptyState>Aucun ticket.</EmptyState>
          ) : (
            <div className="space-y-2">
              {(tickets.data?.items ?? []).map((t) => (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => { setSelected(t.id); setCreating(false); }}
                  className={`w-full rounded-xl border px-4 py-3 text-left transition ${
                    selected === t.id ? 'border-primary bg-primary/10' : 'border-border bg-surface hover:bg-surface2'
                  }`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="truncate font-medium text-fg">{t.subject}</span>
                    <Badge tone={statusTone(t.status)}>{t.status}</Badge>
                  </div>
                  <div className="mt-1 text-xs text-muted">
                    {t._count.messages} message{t._count.messages > 1 ? 's' : ''} · {dateFr(t.updatedAt)}
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>

        <div>
          {creating ? (
            <NewTicketForm
              onCreated={(id) => {
                setCreating(false);
                setSelected(id);
                qc.invalidateQueries({ queryKey: ['support', 'tickets'] });
              }}
              onCancel={() => setCreating(false)}
            />
          ) : selected ? (
            <TicketThread ticketId={selected} />
          ) : (
            <EmptyState>Sélectionnez un ticket ou créez-en un nouveau.</EmptyState>
          )}
        </div>
      </div>
    </div>
  );
}

function NewTicketForm({ onCreated, onCancel }: { onCreated: (id: string) => void; onCancel: () => void }) {
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');

  const mutation = useMutation({
    mutationFn: () => apiPost<{ id: string }>('/support/tickets', { subject, body }),
    onSuccess: (data) => onCreated(data.id),
  });

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    mutation.mutate();
  }

  return (
    <Card>
      <h2 className="mb-4 text-lg font-semibold text-fg">Nouveau ticket</h2>
      <form onSubmit={onSubmit} className="space-y-4">
        <Input label="Sujet" value={subject} onChange={(e) => setSubject(e.target.value)} required />
        <label className="block">
          <span className="mb-1.5 block text-sm text-muted">Message</span>
          <textarea
            className="w-full rounded-xl border border-border bg-surface2 px-3.5 py-2.5 text-fg outline-none placeholder:text-muted focus:border-primary"
            rows={5}
            value={body}
            onChange={(e) => setBody(e.target.value)}
            required
          />
        </label>
        {mutation.error && <ErrorBox message={extractErrorMessage(mutation.error)} />}
        <div className="flex gap-2">
          <Button type="submit" loading={mutation.isPending}>Envoyer</Button>
          <Button type="button" variant="ghost" onClick={onCancel} disabled={mutation.isPending}>
            Annuler
          </Button>
        </div>
      </form>
    </Card>
  );
}

function TicketThread({ ticketId }: { ticketId: string }) {
  const qc = useQueryClient();
  const [reply, setReply] = useState('');

  const ticket = useQuery({
    queryKey: ['support', 'ticket', ticketId],
    queryFn: () => apiGet<TicketDetail>(`/support/tickets/${ticketId}`),
  });

  const sendMessage = useMutation({
    mutationFn: () => apiPost<TicketMessage>(`/support/tickets/${ticketId}/messages`, { body: reply }),
    onSuccess: () => {
      setReply('');
      qc.invalidateQueries({ queryKey: ['support', 'ticket', ticketId] });
      qc.invalidateQueries({ queryKey: ['support', 'tickets'] });
    },
  });

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (reply.trim()) sendMessage.mutate();
  }

  if (ticket.isLoading) return <Loading />;
  if (ticket.error || !ticket.data) {
    return <ErrorBox message={ticket.error ? extractErrorMessage(ticket.error) : 'Ticket introuvable.'} />;
  }

  const closed = ['CLOSED', 'RESOLVED'].includes(ticket.data.status.toUpperCase());

  return (
    <Card>
      <div className="mb-4 flex items-center justify-between gap-2">
        <h2 className="text-lg font-semibold text-fg">{ticket.data.subject}</h2>
        <Badge tone={statusTone(ticket.data.status)}>{ticket.data.status}</Badge>
      </div>

      <div className="space-y-3">
        {ticket.data.messages.map((m) => (
          <div key={m.id} className={`flex ${m.isAdmin ? 'justify-start' : 'justify-end'}`}>
            <div
              className={`max-w-[80%] rounded-2xl px-4 py-2.5 text-sm ${
                m.isAdmin ? 'bg-surface2 text-fg' : 'bg-primary text-white'
              }`}
            >
              <div className="whitespace-pre-line">{m.body}</div>
              <div className={`mt-1 text-xs ${m.isAdmin ? 'text-muted' : 'text-white/70'}`}>
                {m.isAdmin ? 'Support' : m.user.name || 'Vous'} · {dateFr(m.createdAt)}
              </div>
            </div>
          </div>
        ))}
      </div>

      {closed ? (
        <div className="mt-4 text-sm text-muted">Ce ticket est clôturé.</div>
      ) : (
        <form onSubmit={onSubmit} className="mt-4 space-y-3">
          <label className="block">
            <textarea
              className="w-full rounded-xl border border-border bg-surface2 px-3.5 py-2.5 text-fg outline-none placeholder:text-muted focus:border-primary"
              rows={3}
              placeholder="Votre réponse…"
              value={reply}
              onChange={(e) => setReply(e.target.value)}
            />
          </label>
          {sendMessage.error && <ErrorBox message={extractErrorMessage(sendMessage.error)} />}
          <Button type="submit" loading={sendMessage.isPending} disabled={!reply.trim()}>
            Répondre
          </Button>
        </form>
      )}
    </Card>
  );
}
