import { HttpStatus, Injectable } from '@nestjs/common';
import { AuditAction, Prisma, UserRole, VoucherStatus } from '@prisma/client';
import { BusinessException } from '../../common/exceptions/business.exception';
import { ErrorCode } from '../../common/error-codes';
import { PrismaService } from '../../prisma/prisma.service';
import { EventLogService } from '../events/event-log.service';
import { getTenantContext } from '../../common/context/tenant-context';
import { PROVISIONED_WHERE } from './voucher.service';
import type { VoucherSearchQuery } from './dto/voucher-search.schemas';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Curseur opaque : `createdAt` (ms) + id, pour un tri stable même à date égale. */
export function encodeCursor(createdAt: Date, id: string): string {
  return Buffer.from(`${createdAt.getTime()}|${id}`).toString('base64url');
}

export function decodeCursor(cursor: string): { createdAt: Date; id: string } {
  const [ms, id] = Buffer.from(cursor, 'base64url').toString('utf8').split('|');
  const time = Number(ms);
  if (!Number.isFinite(time) || !id || !UUID.test(id)) {
    throw new BusinessException(HttpStatus.BAD_REQUEST, ErrorCode.VOUCHER_INVALID_CURSOR, 'Curseur de pagination invalide.');
  }
  return { createdAt: new Date(time), id };
}

// Le mot de passe n'est JAMAIS renvoyé par la recherche : il ne sort que par la réimpression (journalisée).
const SEARCH_SELECT = {
  id: true,
  code: true,
  status: true,
  batchId: true,
  planId: true,
  plan: { select: { name: true, priceXof: true, durationMinutes: true } },
  createdAt: true,
  usedAt: true,
  expiresAt: true,
} satisfies Prisma.VoucherSelect;

/**
 * Recherche et réimpression par ticket pour OWNER / ADMIN.
 * Le rôle vendeur (TICKET_VERIFIER) est volontairement hors périmètre (Phase 2 gelée).
 */
@Injectable()
export class VoucherSearchService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly eventLog: EventLogService,
  ) {}

  async search(routerId: string, query: VoucherSearchQuery) {
    const where: Prisma.VoucherWhereInput = {
      routerId,
      ...PROVISIONED_WHERE,
      ...(query.q ? { code: { startsWith: query.q, mode: 'insensitive' } } : {}),
      ...(query.status ? { status: query.status } : {}),
      ...(query.batchId ? { batchId: query.batchId } : {}),
    };
    if (query.cursor) {
      const c = decodeCursor(query.cursor);
      where.AND = [
        { OR: [{ createdAt: { lt: c.createdAt } }, { createdAt: c.createdAt, id: { lt: c.id } }] },
      ];
    }
    const rows = await this.prisma.voucher.findMany({
      where,
      select: SEARCH_SELECT,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: query.limit + 1,
    });
    const hasMore = rows.length > query.limit;
    const items = hasMore ? rows.slice(0, query.limit) : rows;
    const last = items[items.length - 1];
    return { items, nextCursor: hasMore && last ? encodeCursor(last.createdAt, last.id) : null };
  }

  /**
   * Renvoie code + mot de passe pour réimprimer. Refusé (409) si le ticket est révoqué ;
   * un ticket déjà utilisé n'est réimprimable que par un OWNER (409 sinon). Aucun code dans les
   * métadonnées d'audit.
   */
  async reprint(routerId: string, voucherId: string) {
    const role = getTenantContext()?.role;
    const voucher = await this.prisma.voucher.findFirst({
      where: { id: voucherId, routerId, ...PROVISIONED_WHERE },
      select: {
        id: true,
        code: true,
        password: true,
        status: true,
        plan: { select: { name: true, priceXof: true, durationMinutes: true } },
      },
    });
    if (!voucher) {
      throw new BusinessException(HttpStatus.NOT_FOUND, ErrorCode.VOUCHER_NOT_FOUND, 'Ticket introuvable.');
    }
    if (voucher.status === VoucherStatus.REVOKED) {
      throw new BusinessException(HttpStatus.CONFLICT, ErrorCode.VOUCHER_REPRINT_FORBIDDEN, 'Ce ticket a été annulé : il ne peut plus être réimprimé.');
    }
    const alreadyUsed = voucher.status !== VoucherStatus.GENERATED;
    if (alreadyUsed && role !== UserRole.OWNER) {
      throw new BusinessException(HttpStatus.CONFLICT, ErrorCode.VOUCHER_REPRINT_FORBIDDEN, 'Ce ticket a déjà été utilisé par un client. Seul le propriétaire du compte peut le réimprimer.');
    }
    return this.eventLog.track(
      {
        action: AuditAction.EXPORT,
        entityType: 'Voucher',
        entityId: voucher.id,
        metadata: { kind: 'reprint', status: voucher.status },
      },
      async () => voucher,
    );
  }
}
