import { RadiusClientsSyncService } from "./radius-clients-sync.service";

// On capture le contenu déposé dans le spool sans toucher au disque : l'API
// écrit un fichier temporaire puis le rename atomiquement sur SPOOL_FILE.
const writeFileMock = jest.fn().mockResolvedValue(undefined);
const renameMock = jest.fn().mockResolvedValue(undefined);
jest.mock("node:fs/promises", () => ({
  writeFile: (...args: any[]) => writeFileMock(...args),
  rename: (...args: any[]) => renameMock(...args),
}));

function makeService(
  opts: {
    radiusEnabled?: boolean;
    members?: any[];
  } = {},
) {
  const prisma = {
    routerLinkMember: {
      findMany: jest.fn().mockResolvedValue(opts.members ?? []),
    },
  };
  const crypto = {
    decrypt: jest.fn((v: string) => v.replace(/^enc\(|\)$/g, "")),
  };
  const config = {
    get: jest.fn((key: string) =>
      key === "RADIUS_ENABLED" ? (opts.radiusEnabled ?? true) : undefined,
    ),
  };
  const svc = new RadiusClientsSyncService(
    prisma as any,
    crypto as any,
    config as any,
  );
  return { svc, prisma, crypto, config };
}

function member(routerId: string, wgIp: string | null, secret: string | null) {
  return {
    router: {
      id: routerId,
      radiusSecretEncrypted: secret,
      remotePeer: wgIp ? { wgIp } : null,
    },
  };
}

/** Contenu réellement déposé dans le spool (2e argument de writeFile(path, content)). */
function spooledContent(): string {
  return writeFileMock.mock.calls[0][1] as string;
}

beforeEach(() => {
  writeFileMock.mockClear();
  renameMock.mockClear();
});

describe("RadiusClientsSyncService", () => {
  it("no-op si RADIUS_ENABLED=false (aucune écriture)", async () => {
    const { svc } = makeService({ radiusEnabled: false });
    await expect(svc.sync()).resolves.toBe(0);
    expect(writeFileMock).not.toHaveBeenCalled();
    expect(renameMock).not.toHaveBeenCalled();
  });

  it("génère un bloc client par NAS, ipaddr=wgIp, secret déchiffré, dans le spool", async () => {
    const { svc } = makeService({
      members: [
        member("r1", "10.20.0.5", "enc(sek1)"),
        member("r2", "10.20.0.6", "enc(sek2)"),
      ],
    });
    const count = await svc.sync();
    expect(count).toBe(2);
    const content = spooledContent();
    expect(content).toContain("ipaddr = 10.20.0.5");
    expect(content).toContain("secret = sek1");
    expect(content).toContain("ipaddr = 10.20.0.6");
    expect(content).toContain("secret = sek2");
    // nom de client assaini (pas de caractère hors [a-zA-Z0-9_]).
    expect(content).toMatch(/client nas_r1 \{/);
  });

  it("écrit un fichier temporaire 0600 puis rename atomiquement sur le spool", async () => {
    const { svc } = makeService({
      members: [member("r1", "10.20.0.5", "enc(topsecret)")],
    });
    await svc.sync();
    const [tmpPath, , opts] = writeFileMock.mock.calls[0];
    const [fromPath, toPath] = renameMock.mock.calls[0];
    // 0600 : le secret en clair n'est lisible que par l'API et root.
    expect(opts).toMatchObject({ mode: 0o600 });
    // Écriture sur un temporaire voisin, rename vers le spool final (pas l'inverse).
    expect(tmpPath).toBe(fromPath);
    expect(tmpPath).not.toBe(toPath);
    expect(toPath).toMatch(/radius-clients\.req$/);
    expect(String(tmpPath)).toMatch(/\.tmp$/);
  });

  it("déduplique un routeur présent dans plusieurs liens", async () => {
    const { svc } = makeService({
      members: [
        member("r1", "10.20.0.5", "enc(s)"),
        member("r1", "10.20.0.5", "enc(s)"),
      ],
    });
    const count = await svc.sync();
    expect(count).toBe(1);
    expect(spooledContent().match(/client nas_r1 \{/g)).toHaveLength(1);
  });

  it("ignore un routeur sans wgIp ou sans secret", async () => {
    const { svc } = makeService({
      members: [member("r1", null, "enc(s)"), member("r2", "10.20.0.6", null)],
    });
    const count = await svc.sync();
    expect(count).toBe(0);
    // Fichier quasi vide (header seul) mais spool quand même réécrit pour purger.
    expect(writeFileMock).toHaveBeenCalledTimes(1);
    expect(renameMock).toHaveBeenCalledTimes(1);
  });
});
