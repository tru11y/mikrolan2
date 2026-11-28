import { profileNameForServer, resolveHotspotServer } from './hotspot.ops';
import type { ApiRow, RouterOsApiClient } from './routeros-api.client';

function makeClient(rows: ApiRow[]) {
  const calls: string[][] = [];
  const command = jest.fn(async (words: string[]) => {
    calls.push(words);
    return rows;
  });
  return { client: { command } as unknown as RouterOsApiClient, calls };
}

describe('resolveHotspotServer', () => {
  it('préfère le serveur nommé exactement HS_SERVER', () => {
    const rows: ApiRow[] = [
      { '.id': '*1', name: 'hotspot1', profile: 'default' },
      { '.id': '*2', name: 'mikrolan', profile: 'mikrolan-hsprof' },
    ];
    expect(resolveHotspotServer(rows, 'mikrolan')?.['.id']).toBe('*2');
  });

  it("retombe sur l'unique serveur réel quand le nom exact est absent", () => {
    const rows: ApiRow[] = [{ '.id': '*1', name: 'hotspot1', profile: 'default' }];
    expect(resolveHotspotServer(rows, 'mikrolan')?.['.id']).toBe('*1');
  });

  it('choisit le premier par nom (déterministe) quand plusieurs serveurs', () => {
    const rows: ApiRow[] = [
      { '.id': '*2', name: 'hotspot2', profile: 'p2' },
      { '.id': '*1', name: 'hotspot1', profile: 'p1' },
    ];
    expect(resolveHotspotServer(rows, 'mikrolan')?.['.id']).toBe('*1');
  });

  it('retourne undefined si aucun serveur hotspot', () => {
    expect(resolveHotspotServer([], 'mikrolan')).toBeUndefined();
  });
});

describe('profileNameForServer (tolérant)', () => {
  it('résout le profil du serveur mikrolan présent', async () => {
    const { client } = makeClient([
      { '.id': '*2', name: 'mikrolan', profile: 'mikrolan-hsprof' },
    ]);
    expect(await profileNameForServer(client, 'mikrolan')).toBe('mikrolan-hsprof');
  });

  it('retombe sur le profil du hotspot natif (rb951)', async () => {
    const { client } = makeClient([
      { '.id': '*1', name: 'hotspot1', profile: 'default' },
    ]);
    expect(await profileNameForServer(client, 'mikrolan')).toBe('default');
  });

  it('throw si le routeur n’a aucun serveur hotspot', async () => {
    const { client } = makeClient([]);
    await expect(profileNameForServer(client, 'mikrolan')).rejects.toThrow(
      /not found/,
    );
  });
});
