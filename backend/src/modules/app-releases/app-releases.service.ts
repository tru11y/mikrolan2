import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { AuditAction, Prisma, type AppRelease } from '@prisma/client';
import { TenantContext } from '../../common/context/tenant-context';
import { ErrorCode } from '../../common/error-codes';
import { BusinessException } from '../../common/exceptions/business.exception';
import { PrismaService } from '../../prisma/prisma.service';
import { EventLogService } from '../events/event-log.service';
import {
  ReleaseStorageService,
  ReleaseStorageUnavailableError,
} from './release-storage.service';
import type { CreateReleaseDto, ListReleasesQueryDto } from './dto/app-release.schemas';

export interface ReleaseView {
  id: string;
  versionName: string;
  versionCode: number;
  minVersionCode: number;
  /** Plancher réellement appliqué : versionCode si la release est obligatoire. */
  effectiveMinVersionCode: number;
  releaseNotes: string;
  fileSize: number;
  storageKey: string;
  isActive: boolean;
  isRequired: boolean;
  archivedAt: Date | null;
  createdAt: Date;
  createdById: string;
}

export interface ReleasePage {
  items: ReleaseView[];
  nextCursor: string | null;
}

export function toView(r: AppRelease): ReleaseView {
  return {
    id: r.id,
    versionName: r.versionName,
    versionCode: r.versionCode,
    minVersionCode: r.minVersionCode,
    effectiveMinVersionCode: r.isRequired ? r.versionCode : r.minVersionCode,
    releaseNotes: r.releaseNotes,
    fileSize: r.fileSize,
    storageKey: r.storageKey,
    isActive: r.isActive,
    isRequired: r.isRequired,
    archivedAt: r.archivedAt,
    createdAt: r.createdAt,
    createdById: r.createdById,
  };
}

@Injectable()
export class AppReleasesService {
  private readonly logger = new Logger(AppReleasesService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: ReleaseStorageService,
    private readonly eventLog: EventLogService,
  ) {}

  async create(dto: CreateReleaseDto, actor: TenantContext): Promise<ReleaseView> {
    const existing = await this.prisma.appRelease.findUnique({
      where: { versionCode: dto.versionCode },
      select: { id: true },
    });
    if (existing) throw this.versionExists(dto.versionCode);

    const size = await this.headSize(dto.storageKey);
    if (size === null) {
      throw new BusinessException(
        HttpStatus.BAD_REQUEST,
        ErrorCode.RELEASE_FILE_MISSING,
        'Fichier APK introuvable dans le stockage',
      );
    }
    if (size !== dto.fileSize) {
      throw new BusinessException(
        HttpStatus.BAD_REQUEST,
        ErrorCode.RELEASE_FILE_SIZE_MISMATCH,
        'La taille déclarée ne correspond pas au fichier stocké',
        { declared: dto.fileSize, stored: size },
      );
    }

    let row: AppRelease;
    try {
      row = await this.prisma.appRelease.create({
        data: { ...dto, createdById: actor.userId },
      });
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        throw this.versionExists(dto.versionCode);
      }
      throw err;
    }

    await this.audit(actor, AuditAction.CREATE, row.id, {
      versionName: row.versionName,
      versionCode: row.versionCode,
    });
    return toView(row);
  }

  async list(query: ListReleasesQueryDto): Promise<ReleasePage> {
    const rows = await this.prisma.appRelease.findMany({
      where: query.includeArchived === 'true' ? {} : { archivedAt: null },
      orderBy: [{ versionCode: 'desc' }, { id: 'desc' }],
      take: query.limit + 1,
      ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
    });
    const hasMore = rows.length > query.limit;
    const items = hasMore ? rows.slice(0, query.limit) : rows;
    return {
      items: items.map(toView),
      nextCursor: hasMore ? items[items.length - 1].id : null,
    };
  }

  /** Release active + URL signée de courte durée (null si le stockage est indisponible). */
  async latest(): Promise<ReleaseView & { downloadUrl: string | null }> {
    const row = await this.prisma.appRelease.findFirst({
      where: { isActive: true, archivedAt: null },
    });
    if (!row) throw this.notFound();

    let downloadUrl: string | null = null;
    try {
      downloadUrl = await this.storage.presignDownload(row.storageKey);
    } catch (err) {
      if (!(err instanceof ReleaseStorageUnavailableError)) throw err;
      this.logger.warn('Stockage APK indisponible : downloadUrl omis');
    }
    return { ...toView(row), downloadUrl };
  }

  async activate(id: string, actor: TenantContext): Promise<ReleaseView> {
    const release = await this.getLive(id);
    const row = await this.prisma.$transaction(async (tx) => {
      await tx.appRelease.updateMany({
        where: { isActive: true, id: { not: id } },
        data: { isActive: false },
      });
      return tx.appRelease.update({ where: { id }, data: { isActive: true } });
    });
    await this.audit(actor, AuditAction.ACTIVATE, id, {
      versionCode: release.versionCode,
    });
    return toView(row);
  }

  async setRequired(id: string, required: boolean, actor: TenantContext): Promise<ReleaseView> {
    await this.getLive(id);
    const row = await this.prisma.appRelease.update({
      where: { id },
      data: { isRequired: required },
    });
    await this.audit(actor, AuditAction.UPDATE, id, { isRequired: required });
    return toView(row);
  }

  async archive(id: string, actor: TenantContext): Promise<ReleaseView> {
    const release = await this.getLive(id);
    if (release.isActive) {
      throw new BusinessException(
        HttpStatus.CONFLICT,
        ErrorCode.RELEASE_ACTIVE_CANNOT_ARCHIVE,
        'Activez une autre release avant d’archiver celle-ci',
      );
    }
    const row = await this.prisma.appRelease.update({
      where: { id },
      data: { archivedAt: new Date() },
    });
    await this.audit(actor, AuditAction.REVOKE, id, { versionCode: release.versionCode });
    return toView(row);
  }

  private async getLive(id: string): Promise<AppRelease> {
    const row = await this.prisma.appRelease.findUnique({ where: { id } });
    if (!row) throw this.notFound();
    if (row.archivedAt) {
      throw new BusinessException(
        HttpStatus.CONFLICT,
        ErrorCode.RELEASE_ARCHIVED,
        'Release archivée',
      );
    }
    return row;
  }

  private async headSize(key: string): Promise<number | null> {
    try {
      return await this.storage.headSize(key);
    } catch (err) {
      if (err instanceof ReleaseStorageUnavailableError) {
        throw new BusinessException(
          HttpStatus.SERVICE_UNAVAILABLE,
          ErrorCode.RELEASE_STORAGE_UNAVAILABLE,
          'Stockage des APK indisponible',
        );
      }
      throw err;
    }
  }

  private notFound(): BusinessException {
    return new BusinessException(
      HttpStatus.NOT_FOUND,
      ErrorCode.RELEASE_NOT_FOUND,
      'Release introuvable',
    );
  }

  private versionExists(versionCode: number): BusinessException {
    return new BusinessException(
      HttpStatus.CONFLICT,
      ErrorCode.RELEASE_VERSION_EXISTS,
      'Ce versionCode existe déjà',
      { versionCode },
    );
  }

  private audit(
    actor: TenantContext,
    action: AuditAction,
    entityId: string,
    metadata: Prisma.InputJsonObject,
  ): Promise<void> {
    return this.eventLog.success(action, 'AppRelease', entityId, metadata, {
      tenantId: actor.tenantId,
      userId: actor.userId,
    });
  }
}
