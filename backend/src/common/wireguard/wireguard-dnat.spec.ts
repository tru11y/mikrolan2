const calls: string[][] = [];

jest.mock('node:child_process', () => ({
  execFile: (_cmd: string, args: string[], cb: (e: Error | null, r: { stdout: string }) => void) => {
    calls.push(args);
    cb(null, { stdout: '' });
  },
}));

import { assertIp, WireGuardService } from './wireguard.service';

const ports = { webfigPort: 80, sshPort: 22, winboxPort: 8291 };

function service(): WireGuardService {
  const config = { get: (k: string) => (k === 'WG_ENABLED' ? true : k === 'WG_INTERFACE' ? 'wg-mgmt' : '10.20.0.0/24') };
  const svc = new WireGuardService(config as never);
  (svc as unknown as { dnatReady: boolean }).dnatReady = true;
  return svc;
}

const rules = () => calls.filter((a) => a.includes('MIKROLAN_DNAT') || a.includes('MIKROLAN_FWD'));

beforeEach(() => {
  calls.length = 0;
});

describe('WireGuardService DNAT — jamais de règle sans IP source', () => {
  it('addDnat : chaque règle DNAT et FORWARD est restreinte à -s <ip>', async () => {
    await service().addDnat('10.20.0.2', 41_000, ports, '203.0.113.7');
    const added = rules().filter((a) => a.includes('-A'));
    expect(added).toHaveLength(4);
    for (const r of added) expect(r.slice(r.indexOf('-s'), r.indexOf('-s') + 2)).toEqual(['-s', '203.0.113.7']);
  });

  it('removeDnat : supprime avec la même IP source, no-op sans fenêtre', async () => {
    await service().removeDnat('10.20.0.2', 41_000, ports, '203.0.113.7');
    expect(rules().filter((a) => a.includes('-D'))).toHaveLength(4);

    calls.length = 0;
    await service().removeDnat('10.20.0.2', 41_000, ports, null);
    expect(calls).toHaveLength(0);
  });

  it('syncDnat sans peer ouvert : chaînes vidées, aucune règle publiée', async () => {
    await service().syncDnat([]);
    expect(rules().filter((a) => a.includes('-A'))).toHaveLength(0);
    expect(rules().some((a) => a.includes('-F'))).toBe(true);
  });

  it('syncDnat : règles restreintes à l’IP de la fenêtre', async () => {
    await service().syncDnat([{ wgIp: '10.20.0.2', allocatedPort: 41_000, accessSourceIp: '198.51.100.9' }]);
    const added = rules().filter((a) => a.includes('-A'));
    expect(added).toHaveLength(4);
    for (const r of added) expect(r).toContain('198.51.100.9');
  });

  it('rejette une IP source invalide (injection / hors plage)', async () => {
    await expect(service().addDnat('10.20.0.2', 41_000, ports, '999.1.1.1')).rejects.toThrow('Invalid IP');
    await expect(service().addDnat('10.20.0.2', 41_000, ports, '1.1.1.1; ls')).rejects.toThrow('Invalid IP');
    expect(() => assertIp('1.2.3')).toThrow();
  });
});
