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
  $executeRaw: jest.fn().mockResolvedValue(1),
  $transaction: jest.fn((fn: (tx: typeof mockPrisma) => Promise<unknown>) => fn(mockPrisma)),
};
const mockStorage = {
  headSize: jest.fn(),
  presignDownload: jest.fn(),
  presignUpload: jest.fn(),
};
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

describe('AppReleasesService.createUploadTarget', () => {
  const req = { versionCode: 41, fileSize: 5000 };

  it('renvoie une clé conforme et une URL signée, et audite', async () => {
    mockStorage.presignUpload.mockResolvedValue('https://s3/put');

    const out = await build().createUploadTarget(req, actor);

    expect(out.storageKey).toMatch(/^releases\/android\/mikrolan-41-[0-9a-f]{12}\.apk$/);
    expect(out.uploadUrl).toBe('https://s3/put');
    expect(out.headers['Content-Type']).toBe('application/vnd.android.package-archive');
    expect(mockStorage.presignUpload).toHaveBeenCalledWith(out.storageKey, 5000);
    expect(eventLog.success).toHaveBeenCalledWith(
      'UPLOAD', 'AppRelease', out.storageKey, expect.any(Object), expect.any(Object),
    );
  });

  it('la clé générée est acceptée par le schéma de création', async () => {
    mockStorage.presignUpload.mockResolvedValue('u');
    const { createReleaseSchema } = await import('./dto/app-release.schemas');
    const out = await build().createUploadTarget(req, actor);
    expect(
      createReleaseSchema.safeParse({ ...dto, versionCode: 41, storageKey: out.storageKey }).success,
    ).toBe(true);
  });

  it('refuse un versionCode déjà utilisé avant tout envoi (409)', async () => {
    mockPrisma.appRelease.findUnique.mockResolvedValue({ id: 'x' });
    expect(await codeOf(build().createUploadTarget(req, actor))).toBe(ErrorCode.RELEASE_VERSION_EXISTS);
    expect(mockStorage.presignUpload).not.toHaveBeenCalled();
  });

  it('503 si le stockage est indisponible', async () => {
    mockStorage.presignUpload.mockRejectedValue(new ReleaseStorageUnavailableError('down'));
    expect(await codeOf(build().createUploadTarget(req, actor))).toBe(ErrorCode.RELEASE_STORAGE_UNAVAILABLE);
  });
});

describe('AppReleasesService.list (auteur)', () => {
  it('expose l’e-mail de l’auteur, null s’il est absent', async () => {
    mockPrisma.appRelease.findMany.mockResolvedValue([
      row({ id: 'a', createdBy: { email: 'root@x.io' } }),
      row({ id: 'b' }),
    ]);
    const page = await build().list({ includeArchived: 'false', limit: 25 });
    expect(page.items.map((i) => i.createdByEmail)).toEqual(['root@x.io', null]);
    expect(mockPrisma.appRelease.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ include: { createdBy: { select: { email: true } } } }),
    );
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
    expect(mockPrisma.appRelease.updateMany).not.toHaveBeenCalled();
    expect(mockPrisma.appRelease.update).not.toHaveBeenCalled();
  });
});

describe('AppReleasesService — verrou de transitions', () => {
  const order: string[] = [];
  beforeEach(() => {
    order.length = 0;
    mockPrisma.$executeRaw.mockImplementation(async () => { order.push('lock'); return 1; });
    mockPrisma.appRelease.findUnique.mockImplementation(async () => { order.push('read'); return row(); });
    mockPrisma.appRelease.update.mockImplementation(async () => { order.push('write'); return row({ isActive: true }); });
  });
  afterEach(() => {
    mockPrisma.$executeRaw.mockReset().mockResolvedValue(1);
    mockPrisma.appRelease.findUnique.mockReset();
    mockPrisma.appRelease.update.mockReset();
  });

  it.each([
    ['activate', (s: AppReleasesService) => s.activate('rel-1', actor)],
    ['setRequired', (s: AppReleasesService) => s.setRequired('rel-1', true, actor)],
    ['archive', (s: AppReleasesService) => s.archive('rel-1', actor)],
  ])('%s : verrou pris AVANT la relecture de l’état, dans une seule transaction', async (_n, call) => {
    await call(build());
    expect(order.slice(0, 2)).toEqual(['lock', 'read']);
    expect(order[order.length - 1]).toBe('write');
    expect(mockPrisma.$transaction).toHaveBeenCalledTimes(1);
  });

  it('le verrou advisory transactionnel est bien demandé', async () => {
    await build().activate('rel-1', actor);
    const sql = mockPrisma.$executeRaw.mock.calls[0][0];
    expect(sql.strings.join('')).toContain('pg_advisory_xact_lock');
  });

  it('un échec dans la transaction se propage et n’audite pas', async () => {
    mockPrisma.appRelease.update.mockRejectedValue(new Error('boom'));
    await expect(build().activate('rel-1', actor)).rejects.toThrow('boom');
    expect(eventLog.success).not.toHaveBeenCalled();
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

  it('propose un nom de fichier lisible (mikrolan-<version>.apk), pas la clé de stockage', async () => {
    mockPrisma.appRelease.findFirst.mockResolvedValue(row({ isActive: true, versionName: '1.1.6', storageKey: 'releases/android/mikrolan-41-8ff38170bf9f.apk' }));
    mockStorage.presignDownload.mockResolvedValue('u');
    await build().latest();
    expect(mockStorage.presignDownload).toHaveBeenCalledWith('releases/android/mikrolan-41-8ff38170bf9f.apk', 'mikrolan-1.1.6.apk');
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
