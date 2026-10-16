import { classifyPeer, HANDSHAKE_FRESH_S, stateSeverity } from './wireguard-state';

const NOW = 1_700_000_000;

describe('classifyPeer', () => {
  it('ACTIVE : handshake de moins de 150 s => HEALTHY', () => {
    expect(classifyPeer('ACTIVE', NOW - 149, NOW)).toEqual({ state: 'HEALTHY', handshakeAgeS: 149 });
  });

  it('borne : exactement 150 s => STALE (même règle que le reconciler)', () => {
    expect(classifyPeer('ACTIVE', NOW - HANDSHAKE_FRESH_S, NOW).state).toBe('STALE');
    expect(classifyPeer('ACTIVE', NOW - 151, NOW).state).toBe('STALE');
  });

  it('ACTIVE sans aucun handshake (0) => NEVER, âge inconnu', () => {
    expect(classifyPeer('ACTIVE', 0, NOW)).toEqual({ state: 'NEVER', handshakeAgeS: null });
  });

  it('ACTIVE avec lecture live indisponible => UNKNOWN, jamais NEVER', () => {
    expect(classifyPeer('ACTIVE', null, NOW)).toEqual({ state: 'UNKNOWN', handshakeAgeS: null });
  });

  it.each(['PENDING', 'REVOKED', 'ERROR'] as const)('%s garde son statut quel que soit le handshake', (status) => {
    expect(classifyPeer(status, NOW - 10, NOW).state).toBe(status);
    expect(classifyPeer(status, 0, NOW).state).toBe(status);
    expect(classifyPeer(status, null, NOW).state).toBe(status);
  });

  it('un handshake dans le futur (dérive d’horloge) donne un âge de 0, pas négatif', () => {
    expect(classifyPeer('ACTIVE', NOW + 30, NOW)).toEqual({ state: 'HEALTHY', handshakeAgeS: 0 });
  });
});

describe('stateSeverity', () => {
  it('place les tunnels cassés avant les sains et les révoqués en dernier', () => {
    const order = ['NEVER', 'STALE', 'UNKNOWN', 'ERROR', 'PENDING', 'HEALTHY', 'REVOKED'] as const;
    const sorted = [...order].sort((a, b) => stateSeverity(a) - stateSeverity(b));
    expect(sorted).toEqual([...order]);
  });
});
