import {
  HttpStatus,
  Injectable,
  Logger,
  StreamableFile,
} from '@nestjs/common';
import { AuditAction } from '@prisma/client';
import { BusinessException } from '../../common/exceptions/business.exception';
import { ErrorCode } from '../../common/error-codes';
import { writeFile, mkdir, readFile } from 'node:fs/promises';
import { basename, join, resolve, sep } from 'node:path';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../../prisma/prisma.service';
import { EventLogService } from '../events/event-log.service';

const VAULT_DIR = join('private-uploads', 'ticket-vault');
const FILENAME_PATTERN = /^[A-Za-z0-9._-]+\.pdf$/i;

@Injectable()
export class TicketVaultService {
  private readonly logger = new Logger(TicketVaultService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly eventLog: EventLogService,
  ) {}

  async store(
    tenantId: string,
    batchId: string,
    pdfBuffer: Buffer,
    originalName: string,
  ): Promise<{ id: string; storagePath: string }> {
    try {
      const dir = resolve(process.cwd(), VAULT_DIR, tenantId);
      await mkdir(dir, { recursive: true });

      const filename = `${randomUUID()}.pdf`;
      const storagePath = join(VAULT_DIR, tenantId, filename);
      await writeFile(join(dir, filename), pdfBuffer);

      const record = await this.prisma.ticketVault.create({
        data: {
          tenantId,
          batchId,
          fileName: originalName || `batch-${batchId}.pdf`,
          storagePath,
          sizeByte: pdfBuffer.length,
        },
      });

      await this.prisma.voucherBatch.update({
        where: { id: batchId },
        data: { pdfUrl: `/api/vouchers/vault/${record.id}` },
      });

      this.logger.log(`Stored PDF for batch ${batchId} (${pdfBuffer.length} bytes)`);
      await this.eventLog.success(AuditAction.CREATE, 'TicketVault', record.id, {
        batchId,
        fileName: record.fileName,
        sizeByte: pdfBuffer.length,
      }, { tenantId });
      return { id: record.id, storagePath };
    } catch (err) {
      this.logger.error(`Vault store failed for batch ${batchId}: ${err instanceof Error ? err.message : err}`);
      await this.traceFailure(tenantId, AuditAction.CREATE, batchId, err, { batchId });
      if (err instanceof BusinessException) throw err;
      throw new BusinessException(
        HttpStatus.INTERNAL_SERVER_ERROR,
        ErrorCode.VAULT_UPLOAD_FAILED,
        "Le PDF n'a pas pu être archivé. Réessayez.",
      );
    }
  }

  /** Trace un échec du coffre (validation d'upload, lecture, chemin refusé). */
  traceFailure(
    tenantId: string,
    action: AuditAction,
    entityId: string,
    err: unknown,
    metadata?: Record<string, string | number>,
  ): Promise<void> {
    return this.eventLog.failure(action, 'TicketVault', entityId, err, metadata, { tenantId });
  }

  async download(vaultId: string, tenantId?: string): Promise<StreamableFile & { fileName: string }> {
    const where: { id: string; tenantId?: string } = { id: vaultId };
    if (tenantId) where.tenantId = tenantId;

    const reject = async (reason: string): Promise<never> => {
      const err = new BusinessException(HttpStatus.NOT_FOUND, ErrorCode.VAULT_PDF_NOT_FOUND, 'PDF introuvable.');
      if (tenantId) await this.traceFailure(tenantId, AuditAction.EXPORT, vaultId, err, { reason });
      throw err;
    };

    const record = await this.prisma.ticketVault.findFirst({ where });
    if (!record) return reject('not_found');

    const absPath = resolve(process.cwd(), record.storagePath);
    const normalized = absPath.split(sep).join('/');
    const vaultRoot = resolve(process.cwd(), VAULT_DIR).split(sep).join('/');
    if (!normalized.startsWith(vaultRoot + '/')) return reject('path_outside_vault');

    const safeName = basename(record.storagePath);
    if (!FILENAME_PATTERN.test(safeName)) return reject('bad_filename');

    let buffer: Buffer;
    try {
      buffer = await readFile(absPath);
    } catch {
      return reject('file_missing_on_disk');
    }
    const stream = new StreamableFile(buffer, {
      type: 'application/pdf',
      disposition: `attachment; filename="${record.fileName}"`,
    });

    if (tenantId) {
      await this.eventLog.success(AuditAction.EXPORT, 'TicketVault', vaultId, {
        fileName: record.fileName,
      }, { tenantId });
    }
    return Object.assign(stream, { fileName: record.fileName });
  }

  async listByBatch(batchId: string) {
    return this.prisma.ticketVault.findMany({
      where: { batchId },
      select: { id: true, fileName: true, sizeByte: true, createdAt: true },
      orderBy: { createdAt: 'desc' },
    });
  }
}
