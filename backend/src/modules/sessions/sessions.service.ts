import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, SessionStatus, VoucherStatus } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { RemoteRouterService } from '../remote-access/remote-router.service';
import { listActive, removeActive } from '../../common/routeros/hotspot.ops';
import { getTenantContext } from '../../common/context/tenant-context';

const SESSION_PUBLIC = {
  id: true,
  voucherId: true,
  routerId: true,
  macAddress: true,
  ipAddress: true,
  status: true,
  bytesIn: true,
  bytesOut: true,
  startedAt: true,
  lastSeenAt: true,
} satisfies Prisma.SessionSelect;

type SessionRow = Prisma.SessionGetPayload<{ select: typeof SESSION_PUBLIC }>;

// BigInt is not JSON-serializable — expose byte counters as strings.
function serialize(s: SessionRow) {
  return { ...s, bytesIn: s.bytesIn.toString(), bytesOut: s.bytesOut.toString() };
}

@Injectable()
export class SessionsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly remote: RemoteRouterService,
  ) {}

  /** Pulls the router's live hotspot sessions over the tunnel and reflects them. */
  async sync(routerId: string) {
    await this.assertRouter(routerId);
    const active = await this.remote.run(routerId, (c) => listActive(c));

    const codes = active.map((r) => r.user).filter(Boolean);
    const vouchers = codes.length
      ? await this.prisma.voucher.findMany({
          where: { routerId, code: { in: codes } },
          select: { id: true, code: true },
        })
      : [];
    const voucherByCode = new Map(vouchers.map((v) => [v.code, v.id]));

    for (const row of active) {
      const voucherId = voucherByCode.get(row.user);
      if (!voucherId) continue;

      const data = {
        routerId,
        mikrotikId: row['.id'] ?? null,
        macAddress: row['mac-address'] ?? null,
        ipAddress: row.address ?? null,
        status: SessionStatus.ACTIVE,
        bytesIn: BigInt(row['bytes-in'] ?? '0'),
        bytesOut: BigInt(row['bytes-out'] ?? '0'),
        lastSeenAt: new Date(),
      };

      const existing = await this.prisma.session.findFirst({
        where: { voucherId },
        select: { id: true },
      });
      if (existing) {
        await this.prisma.session.updateMany({
          where: { id: existing.id },
          data,
        });
      } else {
        const tenantId = getTenantContext()?.tenantId;
        if (!tenantId) continue;
        await this.prisma.session.create({
          data: {
            tenantId,
            voucherId,
            ...data,
          } satisfies Prisma.SessionUncheckedCreateInput,
        });
      }

      await this.prisma.voucher.updateMany({
        where: { id: voucherId, status: VoucherStatus.GENERATED },
        data: { status: VoucherStatus.ACTIVE, usedAt: new Date() },
      });
    }

    return this.list(routerId);
  }

  async list(routerId: string) {
    const rows = await this.prisma.session.findMany({
      where: { routerId, status: SessionStatus.ACTIVE },
      select: SESSION_PUBLIC,
      orderBy: { startedAt: 'desc' },
      take: 500,
    });
    return rows.map(serialize);
  }

  async terminate(sessionId: string) {
    const session = await this.prisma.session.findFirst({
      where: { id: sessionId },
      select: { id: true, routerId: true, mikrotikId: true },
    });
    if (!session) throw new NotFoundException('Session not found');

    if (session.mikrotikId) {
      try {
        await this.remote.run(session.routerId, (c) =>
          removeActive(c, session.mikrotikId as string),
        );
      } catch {
        // router unreachable — DB state stays authoritative
      }
    }

    await this.prisma.session.updateMany({
      where: { id: sessionId },
      data: { status: SessionStatus.TERMINATED, terminatedAt: new Date() },
    });
    return { terminated: true };
  }

  private async assertRouter(routerId: string): Promise<void> {
    const router = await this.prisma.router.findFirst({
      where: { id: routerId, deletedAt: null },
      select: { id: true },
    });
    if (!router) throw new NotFoundException('Router not found');
  }
}
