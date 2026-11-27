import { AccessMode, RemotePeerStatus, RemoteTunnelCloseReason } from '@prisma/client';
import { CloseCode } from './tunnel-protocol';
import {
  MAX_SESSIONS_PER_USER,
  RemoteTunnelService,
  TICKET_TTL_MS,
} from './remote-tunnel.service';

interface Row {
  id: string;
  tenantId: string;
  routerId: string;
  peerId: string;
  userId: string;
  ticketHash: string;
  sourceIp: string;
  expiresAt: Date;
  connectedAt: Date | null;
  closedAt: Date | null;
  closeReason: RemoteTunnelCloseReason | null;
  createdAt: Date;
}

/** Fake Prisma minimal, en mémoire, pour piloter le cycle de vie des sessions. */
function makeFakePrisma(peerOverrides: Partial<Record<string, unknown>> = {}) {
  const sessions = new Map<string, Row>();
  let seq = 0;
  const peer = {
    id: 'peer-1',
    status: RemotePeerStatus.ACTIVE,
    accessMode: AccessMode.TUNNEL,
    accessOpenUntil: new Date(Date.now() + 60_000),
    wgIp: '10.20.0.2',
    webfigPort: 80,
    sshPort: 22,
    winboxPort: 8291,
    ...peerOverrides,
  };

  const match = (r: Row, where: Record<string, unknown>): boolean =>
    Object.entries(where).every(([k, v]) => {
      if (k === 'connectedAt' || k === 'closedAt') return r[k as keyof Row] === (v as null);
      if (k === 'expiresAt' && typeof v === 'object' && v && 'gt' in v) {
        return r.expiresAt.getTime() > (v as { gt: Date }).gt.getTime();
      }
      if (k === 'expiresAt' && typeof v === 'object' && v && 'lte' in v) {
        return r.expiresAt.getTime() <= (v as { lte: Date }).lte.getTime();
      }
      if (k === 'NOT') return !match(r, v as Record<string, unknown>);
      return r[k as keyof Row] === v;
    });

  const prisma = {
    __sessions: sessions,
    __peer: peer,
    remoteTunnelSession: {
      count: jest.fn(async ({ where }: { where: Record<string, unknown> }) =>
        [...sessions.values()].filter((r) => match(r, where)).length,
      ),
      create: jest.fn(async ({ data }: { data: Partial<Row> }) => {
        const defaults = {
          id: `s${seq++}`,
          connectedAt: null,
          closedAt: null,
          closeReason: null,
          createdAt: new Date(),
        };
        const row = { ...defaults, ...(data as Record<string, unknown>) } as Row;
        sessions.set(row.id, row);
        return { ...row };
      }),
      findUnique: jest.fn(async ({ where }: { where: { ticketHash: string } }) => {
        const row = [...sessions.values()].find((r) => r.ticketHash === where.ticketHash);
        return row ? { ...row } : null;
      }),
      updateMany: jest.fn(
        async ({ where, data }: { where: Record<string, unknown>; data: Partial<Row> }) => {
          let count = 0;
          for (const r of sessions.values()) {
            if (match(r, where)) {
              Object.assign(r, data);
              count += 1;
            }
          }
          return { count };
        },
      ),
    },
    remotePeer: {
      findUnique: jest.fn(async ({ where }: { where: { id: string } }) =>
        where.id === peer.id ? { ...peer } : null,
      ),
    },
  };
  return prisma;
}

function svc(prisma: ReturnType<typeof makeFakePrisma>): RemoteTunnelService {
  return new RemoteTunnelService(prisma as never);
}

const baseInput = {
  tenantId: 't1',
  routerId: 'r1',
  peerId: 'peer-1',
  userId: 'u1',
  sourceIp: '1.2.3.4',
};

describe('RemoteTunnelService — ticket lifecycle', () => {
  it('issues a ticket and consumes it exactly once (single use)', async () => {
    const prisma = makeFakePrisma();
    const service = svc(prisma);
    const { ticket, ticketExpiresInSec } = await service.issueTicket({
      ...baseInput,
      expiresAt: new Date(Date.now() + 60_000),
    });
    expect(ticketExpiresInSec).toBe(60);

    const first = await service.consumeTicket(ticket, '1.2.3.4');
    expect(first.ok).toBe(true);

    const replay = await service.consumeTicket(ticket, '1.2.3.4');
    expect(replay).toEqual({ ok: false, code: CloseCode.TICKET_INVALID });
  });

  it('rejects an unknown ticket as TICKET_INVALID', async () => {
    const service = svc(makeFakePrisma());
    const res = await service.consumeTicket('not-a-real-ticket', '1.2.3.4');
    expect(res).toEqual({ ok: false, code: CloseCode.TICKET_INVALID });
  });

  it('rejects a ticket from a different source IP (4403)', async () => {
    const prisma = makeFakePrisma();
    const service = svc(prisma);
    const { ticket } = await service.issueTicket({
      ...baseInput,
      expiresAt: new Date(Date.now() + 60_000),
    });
    const res = await service.consumeTicket(ticket, '9.9.9.9');
    expect(res).toEqual({ ok: false, code: CloseCode.IP_MISMATCH });
  });

  it('rejects an expired ticket (TTL 60 s) as TICKET_INVALID', async () => {
    const prisma = makeFakePrisma();
    const service = svc(prisma);
    const { ticket } = await service.issueTicket({
      ...baseInput,
      expiresAt: new Date(Date.now() + 10 * 60_000),
    });
    // Force la date d'émission dans le passé (> 60 s).
    for (const r of prisma.__sessions.values()) {
      r.createdAt = new Date(Date.now() - TICKET_TTL_MS - 1000);
    }
    const res = await service.consumeTicket(ticket, '1.2.3.4');
    expect(res).toEqual({ ok: false, code: CloseCode.TICKET_INVALID });
  });

  it('rejects a ticket whose access window has expired (4408)', async () => {
    const prisma = makeFakePrisma({ accessOpenUntil: new Date(Date.now() - 1000) });
    const service = svc(prisma);
    const { ticket } = await service.issueTicket({
      ...baseInput,
      expiresAt: new Date(Date.now() - 1000),
    });
    const res = await service.consumeTicket(ticket, '1.2.3.4');
    expect(res).toEqual({ ok: false, code: CloseCode.WINDOW_EXPIRED });
  });

  it('rejects when the peer is no longer in TUNNEL mode (4408)', async () => {
    const prisma = makeFakePrisma({ accessMode: AccessMode.DIRECT });
    const service = svc(prisma);
    const { ticket } = await service.issueTicket({
      ...baseInput,
      expiresAt: new Date(Date.now() + 60_000),
    });
    const res = await service.consumeTicket(ticket, '1.2.3.4');
    expect(res).toEqual({ ok: false, code: CloseCode.WINDOW_EXPIRED });
  });

  it('enforces the per-user session quota (REMOTE_TUNNEL_LIMIT)', async () => {
    const prisma = makeFakePrisma();
    const service = svc(prisma);
    // Deux sessions ouvertes sur d'AUTRES peers → quota atteint.
    for (let i = 0; i < MAX_SESSIONS_PER_USER; i++) {
      await prisma.remoteTunnelSession.create({
        data: {
          id: `other${i}`,
          tenantId: 't1',
          routerId: `r${i}`,
          peerId: `other-peer-${i}`,
          userId: 'u1',
          ticketHash: `h${i}`,
          sourceIp: '1.2.3.4',
          expiresAt: new Date(Date.now() + 60_000),
        } as never,
      });
    }
    await expect(
      service.issueTicket({ ...baseInput, expiresAt: new Date(Date.now() + 60_000) }),
    ).rejects.toMatchObject({ errorCode: 'REMOTE_TUNNEL_LIMIT' });
  });

  it('issuing a new ticket replaces the peer\'s previous open sessions', async () => {
    const prisma = makeFakePrisma();
    const service = svc(prisma);
    await service.issueTicket({ ...baseInput, expiresAt: new Date(Date.now() + 60_000) });
    await service.issueTicket({ ...baseInput, expiresAt: new Date(Date.now() + 60_000) });
    const rows = [...prisma.__sessions.values()];
    const replaced = rows.filter((r) => r.closeReason === RemoteTunnelCloseReason.REPLACED);
    expect(replaced.length).toBe(1);
  });
});
