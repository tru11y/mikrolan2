import { Prisma } from '@prisma/client';
import { makeEventLogStub } from '../../common/testing/event-log.stub';
import { ErrorCode } from '../../common/error-codes';
import { AppReleasesService } from './app-releases.service';
import { ReleaseStorageUnavailableError } from './release-storage.service';

const actor = { userId: 'admin-1', tenantId: 'platform', role: 'SUPER_ADMIN' } as any;

const mockPrisma: Record<string, any> = {
  appRelease: {
    findUnique: jest.fn(),
    findFirst: jest.fn(),
    findMany: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    updateMany: jest.fn(),
  },
  $executeRaw: jest.fn().mockResolvedValue(0),
  $transaction: jest.fn((fn: (tx: typeof mockPrisma) => Promise<unknown>) => fn(mockPrisma)),
};
const mockStorage = { headSize: jest.fn(), presignDownload: jest.fn() };
const eventLog = makeEventLogStub();

const build = () => new AppReleasesService(mockPrisma as any, mockStorage as any, eventLog as any);

const row = (over: Record<string, unknown> = {}) => ({
  id: 'rel-1',
  versionName: '1.2.0',
  versionCode: 40,
  minVersionCode: 30,
  releaseNotes: 'notes',
  fileSize: 1000,
  storageKey: 'releases/android/mikrolan-1.2.0.apk',
  isActive: false,
  isRequired: false,
  archivedAt: null,
  createdAt: new Date('2026-10-16T00:00:00Z'),
  createdById: 'admin-1',
  ...over,
});

const dto = {
  versionName: '1.2.0',
  versionCode: 40,
  minVersionCode: 30,
  releaseNotes: 'notes',
  fileSize: 1000,
  storageKey: 'releases/android/mikrolan-1.2.0.apk',
};

const codeOf = async (p: Promise<unknown>) =>
  p.then(
    () => null,
    (e) => e.getResponse().errorCode,
  );

beforeEach(() => {
  jest.clearAllMocks();
  mockPrisma.appRelease.findUnique.mockResolvedValue(null);
});

describe('AppReleasesService.create', () => {
  it('crée la release quand le fichier existe avec la bonne taille, et audite', async () => {
    mockStorage.headSize.mockResolvedValue(1000);
    mockPrisma.appRelease.create.mockResolvedValue(row());

    const out = await build().create(dto, actor);

    expect(mockPrisma.appRelease.create).toHaveBeenCalledWith({
      data: { ...dto, createdById: 'admin-1' },
    });
    expect(out.isActive).toBe(false);
    expect(eventLog.success).toHaveBeenCalledWith(
      'CREATE', 'AppRelease', 'rel-1', expect.any(Object),
      { tenantId: 'platform', userId: 'admin-1' },
    );
  });

  it('refuse un versionCode déjà utilisé (409)', async () => {
    mockPrisma.appRelease.findUnique.mockResolvedValue({ id: 'x' });
    expect(await codeOf(build().create(dto, actor))).toBe(ErrorCode.RELEASE_VERSION_EXISTS);
    expect(mockPrisma.appRelease.create).not.toHaveBeenCalled();
  });

  it('traduit une collision concurrente (P2002) en 409', async () => {
    mockStorage.headSize.mockResolvedValue(1000);
    mockPrisma.appRelease.create.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError('dup', { code: 'P2002', clientVersion: 'x' }),
    );
    expect(await codeOf(build().create(dto, actor))).toBe(ErrorCode.RELEASE_VERSION_EXISTS);
  });

  it('refuse un fichier absent du stockage', async () => {
    mockStorage.headSize.mockResolvedValue(null);
    expect(await codeOf(build().create(dto, actor))).toBe(ErrorCode.RELEASE_FILE_MISSING);
    expect(mockPrisma.appRelease.create).not.toHaveBeenCalled();
  });

  it('refuse une taille différente du fichier stocké', async () => {
    mockStorage.headSize.mockResolvedValue(999);
    expect(await codeOf(build().create(dto, actor))).toBe(ErrorCode.RELEASE_FILE_SIZE_MISMATCH);
  });

  it('renvoie 503 si le stockage est indisponible', async () => {
    mockStorage.headSize.mockRejectedValue(new ReleaseStorageUnavailableError('down'));
    expect(await codeOf(build().create(dto, actor))).toBe(ErrorCode.RELEASE_STORAGE_UNAVAILABLE);
  });
});

describe('AppReleasesService.activate', () => {
  it('désactive les autres et active celle-ci dans la même transaction', async () => {
    mockPrisma.appRelease.findUnique.mockResolvedValue(row());
    mockPrisma.appRelease.update.mockResolvedValue(row({ isActive: true }));

    const out = await build().activate('rel-1', actor);

    expect(mockPrisma.$transaction).toHaveBeenCalledTimes(1);
    expect(mockPrisma.appRelease.updateMany).toHaveBeenCalledWith({
      where: { isActive: true, id: { not: 'rel-1' } },
      data: { isActive: false },
    });
    expect(mockPrisma.appRelease.update).toHaveBeenCalledWith({
      where: { id: 'rel-1' },
      data: { isActive: true },
    });
    expect(out.isActive).toBe(true);
    expect(eventLog.success).toHaveBeenCalledWith(
      'ACTIVATE', 'AppRelease', 'rel-1', expect.any(Object), expect.any(Object),
    );
  });

  it('permet le rollback : réactive une ancienne release', async () => {
    mockPrisma.appRelease.findUnique.mockResolvedValue(row({ id: 'old', versionCode: 37 }));
    mockPrisma.appRelease.update.mockResolvedValue(row({ id: 'old', isActive: true }));
    await build().activate('old', actor);
    expect(mockPrisma.appRelease.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { isActive: true, id: { not: 'old' } } }),
    );
  });

  it('404 si la release est inconnue', async () => {
    expect(await codeOf(build().activate('nope', actor))).toBe(ErrorCode.RELEASE_NOT_FOUND);
  });

  it('409 si la release est archivée, sans aucune écriture', async () => {
    mockPrisma.appRelease.findUnique.mockResolvedValue(row({ archivedAt: new Date() }));
    expect(await codeOf(build().activate('rel-1', actor))).toBe(ErrorCode.RELEASE_ARCHIVED);
    expect(mockPrisma.appRelease.update).not.toHaveBeenCalled();
    expect(mockPrisma.appRelease.updateMany).not.toHaveBeenCalled();
  });
});

describe('AppReleasesService.setRequired', () => {
  it('bascule isRequired et audite', async () => {
    mockPrisma.appRelease.findUnique.mockResolvedValue(row());
    mockPrisma.appRelease.update.mockResolvedValue(row({ isRequired: true }));

    const out = await build().setRequired('rel-1', true, actor);

    expect(mockPrisma.appRelease.update).toHaveBeenCalledWith({
      where: { id: 'rel-1' },
      data: { isRequired: true },
    });
    expect(out.effectiveMinVersionCode).toBe(40);
    expect(eventLog.success).toHaveBeenCalled();
  });

  it('refuse une release archivée', async () => {
    mockPrisma.appRelease.findUnique.mockResolvedValue(row({ archivedAt: new Date() }));
    expect(await codeOf(build().setRequired('rel-1', true, actor))).toBe(ErrorCode.RELEASE_ARCHIVED);
  });
});

describe('AppReleasesService.archive', () => {
  it('archive en soft delete (archivedAt) sans toucher à isActive', async () => {
    mockPrisma.appRelease.findUnique.mockResolvedValue(row());
    mockPrisma.appRelease.update.mockResolvedValue(row({ archivedAt: new Date() }));

    await build().archive('rel-1', actor);

    expect(mockPrisma.appRelease.update).toHaveBeenCalledWith({
      where: { id: 'rel-1' },
      data: { archivedAt: expect.any(Date) },
    });
  });

  it('refuse d’archiver la release active (409)', async () => {
    mockPrisma.appRelease.findUnique.mockResolvedValue(row({ isActive: true }));
    expect(await codeOf(build().archive('rel-1', actor))).toBe(ErrorCode.RELEASE_ACTIVE_CANNOT_ARCHIVE);
    expect(mockPrisma.appRelease.update).not.toHaveBeenCalled();
  });

  it('refuse une release déjà archivée', async () => {
    mockPrisma.appRelease.findUnique.mockResolvedValue(row({ archivedAt: new Date() }));
    expect(await codeOf(build().archive('rel-1', actor))).toBe(ErrorCode.RELEASE_ARCHIVED);
  });
});

describe('AppReleasesService.latest', () => {
  it('renvoie la release active avec une URL signée', async () => {
    mockPrisma.appRelease.findFirst.mockResolvedValue(row({ isActive: true }));
    mockStorage.presignDownload.mockResolvedValue('https://s3/signed');

    const out = await build().latest();

    expect(mockPrisma.appRelease.findFirst).toHaveBeenCalledWith({
      where: { isActive: true, archivedAt: null },
      orderBy: [{ versionCode: 'desc' }, { id: 'desc' }],
    });
    expect(out.downloadUrl).toBe('https://s3/signed');
    expect(out.effectiveMinVersionCode).toBe(30);
  });

  it('plancher = versionCode quand la release est obligatoire', async () => {
    mockPrisma.appRelease.findFirst.mockResolvedValue(row({ isActive: true, isRequired: true }));
    mockStorage.presignDownload.mockResolvedValue('u');
    expect((await build().latest()).effectiveMinVersionCode).toBe(40);
  });

  it('downloadUrl null (sans erreur) si le stockage est indisponible', async () => {
    mockPrisma.appRelease.findFirst.mockResolvedValue(row({ isActive: true }));
    mockStorage.presignDownload.mockRejectedValue(new ReleaseStorageUnavailableError('down'));
    expect((await build().latest()).downloadUrl).toBeNull();
  });

  it('404 quand aucune release n’est active', async () => {
    mockPrisma.appRelease.findFirst.mockResolvedValue(null);
    expect(await codeOf(build().latest())).toBe(ErrorCode.RELEASE_NOT_FOUND);
  });
});

describe('AppReleasesService.list', () => {
  it('masque les archivées par défaut et pagine par curseur', async () => {
    mockPrisma.appRelease.findMany.mockResolvedValue([
      row({ id: 'a' }), row({ id: 'b' }), row({ id: 'c' }),
    ]);

    const page = await build().list({ includeArchived: 'false', limit: 2 });

    expect(mockPrisma.appRelease.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { archivedAt: null }, take: 3 }),
    );
    expect(page.items.map((i) => i.id)).toEqual(['a', 'b']);
    expect(page.nextCursor).toBe('b');
  });

  it('inclut les archivées sur demande', async () => {
    mockPrisma.appRelease.findMany.mockResolvedValue([]);
    await build().list({ includeArchived: 'true', limit: 25 });
    expect(mockPrisma.appRelease.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: {} }),
    );
  });
});

describe('AppReleasesService — verrou de concurrence', () => {
  const lockedBeforeRead = async (run: () => Promise<unknown>) => {
    const order: string[] = [];
    mockPrisma.$executeRaw.mockImplementation(async () => {
      order.push('lock');
      return [];
    });
    mockPrisma.appRelease.findUnique.mockImplementation(async () => {
      order.push('read');
      return row();
    });
    mockPrisma.appRelease.update.mockResolvedValue(row());
    await run();
    return order;
  };

  it.each([
    ['activate', () => build().activate('rel-1', actor)],
    ['archive', () => build().archive('rel-1', actor)],
    ['setRequired', () => build().setRequired('rel-1', true, actor)],
  ])('%s : verrou pris AVANT la relecture de l’état, dans la transaction', async (_n, run) => {
    const order = await lockedBeforeRead(run);
    expect(order.slice(0, 2)).toEqual(['lock', 'read']);
    expect(mockPrisma.$transaction).toHaveBeenCalledTimes(1);
  });

  it('latest : tri déterministe (versionCode puis id décroissants)', async () => {
    mockPrisma.appRelease.findFirst.mockResolvedValue(row({ isActive: true }));
    mockStorage.presignDownload.mockResolvedValue('https://s3.test/x');
    await build().latest();
    expect(mockPrisma.appRelease.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ orderBy: [{ versionCode: 'desc' }, { id: 'desc' }] }),
    );
  });
});
