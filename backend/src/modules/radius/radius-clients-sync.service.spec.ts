import { RadiusClientsSyncService } from "./radius-clients-sync.service";

// On capture le contenu poussé sur STDIN du wrapper sans lancer `sudo`.
const execFileMock = jest.fn();
const stdinEnd = jest.fn();
jest.mock("node:child_process", () => ({
  execFile: (...args: any[]) => {
    execFileMock(...args);
    const cb = args[args.length - 1];
    // Succès immédiat.
    setImmediate(() => cb(null, "", ""));
    return { stdin: { end: stdinEnd } };
  },
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

beforeEach(() => {
  execFileMock.mockClear();
  stdinEnd.mockClear();
});

describe("RadiusClientsSyncService", () => {
  it("no-op si RADIUS_ENABLED=false (aucun appel wrapper)", async () => {
    const { svc } = makeService({ radiusEnabled: false });
    await expect(svc.sync()).resolves.toBe(0);
    expect(execFileMock).not.toHaveBeenCalled();
  });

  it("génère un bloc client par NAS, ipaddr=wgIp, secret déchiffré, sur STDIN", async () => {
    const { svc } = makeService({
      members: [
        member("r1", "10.20.0.5", "enc(sek1)"),
        member("r2", "10.20.0.6", "enc(sek2)"),
      ],
    });
    const count = await svc.sync();
    expect(count).toBe(2);
    const content = stdinEnd.mock.calls[0][0] as string;
    expect(content).toContain("ipaddr = 10.20.0.5");
    expect(content).toContain("secret = sek1");
    expect(content).toContain("ipaddr = 10.20.0.6");
    expect(content).toContain("secret = sek2");
    // nom de client assaini (pas de caractère hors [a-zA-Z0-9_]).
    expect(content).toMatch(/client nas_r1 \{/);
  });

  it("ne passe JAMAIS le secret en argv (STDIN only)", async () => {
    const { svc } = makeService({
      members: [member("r1", "10.20.0.5", "enc(topsecret)")],
    });
    await svc.sync();
    const argv = JSON.stringify(execFileMock.mock.calls[0]);
    expect(argv).not.toContain("topsecret");
    expect(execFileMock.mock.calls[0][0]).toBe("sudo");
    expect(execFileMock.mock.calls[0][1]).toEqual([
      "-n",
      "/usr/local/sbin/mikrolan-radius-sync",
    ]);
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
    const content = stdinEnd.mock.calls[0][0] as string;
    expect(content.match(/client nas_r1 \{/g)).toHaveLength(1);
  });

  it("ignore un routeur sans wgIp ou sans secret", async () => {
    const { svc } = makeService({
      members: [member("r1", null, "enc(s)"), member("r2", "10.20.0.6", null)],
    });
    const count = await svc.sync();
    expect(count).toBe(0);
    // Fichier quasi vide (header seul) mais wrapper quand même appelé pour purger.
    expect(execFileMock).toHaveBeenCalledTimes(1);
  });
});
