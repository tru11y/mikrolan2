import {
  disableHotspotRadius,
  ensureHotspotUsesRadius,
  ensureRadiusClient,
  hotspotProfileUsesRadius,
} from './hotspot.ops';
import type { RouterOsApiClient } from './routeros-api.client';

function makeClient(script: Record<number, unknown[]>) {
  const calls: string[][] = [];
  let i = 0;
  const command = jest.fn(async (words: string[]) => {
    calls.push(words);
    const res = script[i] ?? [];
    i += 1;
    return res;
  });
  return { client: { command } as unknown as RouterOsApiClient, calls };
}

describe('ensureRadiusClient (idempotent, .proplist)', () => {
  it('ajoute un client RADIUS absent', async () => {
    const { client, calls } = makeClient({ 0: [] });
    await ensureRadiusClient(client, { server: '10.20.0.1', secret: 's3cr3t' });
    expect(calls[0]).toEqual(['/radius/print', '=.proplist=.id,address,service']);
    expect(calls[1][0]).toBe('/radius/add');
    expect(calls[1]).toEqual(
      expect.arrayContaining(['=service=hotspot', '=address=10.20.0.1', '=secret=s3cr3t']),
    );
  });

  it("ne recrée pas un client existant mais réaligne le secret", async () => {
    const { client, calls } = makeClient({
      0: [{ '.id': '*1', address: '10.20.0.1', service: 'hotspot,login' }],
    });
    await ensureRadiusClient(client, { server: '10.20.0.1', secret: 'newsecret' });
    expect(calls[1]).toEqual(['/radius/set', '=.id=*1', '=secret=newsecret']);
    expect(calls.some((c) => c[0] === '/radius/add')).toBe(false);
  });

  it("n'identifie pas un client d'un autre service comme hotspot", async () => {
    const { client, calls } = makeClient({
      0: [{ '.id': '*9', address: '10.20.0.1', service: 'login,ppp' }],
    });
    await ensureRadiusClient(client, { server: '10.20.0.1', secret: 's' });
    expect(calls[1][0]).toBe('/radius/add');
  });
});

describe('ensureHotspotUsesRadius', () => {
  it('pose use-radius=yes, radius-accounting=yes et interim-update', async () => {
    const { client, calls } = makeClient({
      0: [{ '.id': '*2', name: 'mikrolan-hsprof', 'use-radius': 'no' }],
    });
    await ensureHotspotUsesRadius(client, 'mikrolan-hsprof', { interimUpdate: '30s' });
    expect(calls[0]).toEqual([
      '/ip/hotspot/profile/print',
      '=.proplist=.id,name,use-radius',
    ]);
    expect(calls[1]).toEqual([
      '/ip/hotspot/profile/set',
      '=.id=*2',
      '=use-radius=yes',
      '=radius-accounting=yes',
      '=interim-update=30s',
    ]);
  });

  it('défaut interim-update=30s si non fourni', async () => {
    const { client, calls } = makeClient({
      0: [{ '.id': '*2', name: 'p', 'use-radius': 'no' }],
    });
    await ensureHotspotUsesRadius(client, 'p');
    expect(calls[1]).toEqual(expect.arrayContaining(['=interim-update=30s']));
  });

  it('throw si le profil est absent', async () => {
    const { client } = makeClient({ 0: [{ '.id': '*2', name: 'autre' }] });
    await expect(ensureHotspotUsesRadius(client, 'mikrolan-hsprof')).rejects.toThrow(
      /not found/,
    );
  });
});

describe('disableHotspotRadius (rollback)', () => {
  it('remet use-radius=no et radius-accounting=no', async () => {
    const { client, calls } = makeClient({
      0: [{ '.id': '*3', name: 'p', 'use-radius': 'yes' }],
    });
    await disableHotspotRadius(client, 'p');
    expect(calls[1]).toEqual([
      '/ip/hotspot/profile/set',
      '=.id=*3',
      '=use-radius=no',
      '=radius-accounting=no',
    ]);
  });
});

describe('hotspotProfileUsesRadius', () => {
  it('true quand use-radius=yes', async () => {
    const { client } = makeClient({ 0: [{ '.id': '*4', name: 'p', 'use-radius': 'yes' }] });
    expect(await hotspotProfileUsesRadius(client, 'p')).toBe(true);
  });
  it('false sinon / profil absent', async () => {
    const { client } = makeClient({ 0: [{ '.id': '*4', name: 'p', 'use-radius': 'no' }] });
    expect(await hotspotProfileUsesRadius(client, 'p')).toBe(false);
    const { client: c2 } = makeClient({ 0: [] });
    expect(await hotspotProfileUsesRadius(c2, 'p')).toBe(false);
  });
});
