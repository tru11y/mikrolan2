import { parseWgDump } from './wireguard.service';

const IFACE_LINE = 'privkey=\tserverpub=\t51820\toff';
const peerLine = (pk: string, endpoint: string, handshake: number, rx: number, tx: number) =>
  [pk, '(none)', endpoint, '10.20.0.2/32', String(handshake), String(rx), String(tx), '25'].join('\t');

describe('parseWgDump', () => {
  it('ignore la ligne interface et lit handshake, trafic et endpoint de chaque peer', () => {
    const out = parseWgDump(
      [IFACE_LINE, peerLine('pkA', '41.12.3.4:51000', 1_700_000_000, 1234, 5678), ''].join('\n'),
    );
    expect(out).toEqual({
      pkA: { endpoint: '41.12.3.4:51000', latestHandshake: 1_700_000_000, rxBytes: 1234, txBytes: 5678 },
    });
  });

  it('(none) devient null et un handshake à 0 reste 0 (jamais)', () => {
    const out = parseWgDump([IFACE_LINE, peerLine('pkB', '(none)', 0, 0, 0)].join('\n'));
    expect(out.pkB).toEqual({ endpoint: null, latestHandshake: 0, rxBytes: 0, txBytes: 0 });
  });

  it('gère plusieurs peers', () => {
    const out = parseWgDump(
      [IFACE_LINE, peerLine('pkA', '1.1.1.1:1', 10, 1, 2), peerLine('pkB', '2.2.2.2:2', 20, 3, 4)].join('\n'),
    );
    expect(Object.keys(out)).toEqual(['pkA', 'pkB']);
  });

  it('ignore les lignes mal formées ou vides', () => {
    expect(parseWgDump('')).toEqual({});
    expect(parseWgDump(`${IFACE_LINE}\nn'importe quoi\n\n`)).toEqual({});
  });

  it('un compteur non numérique retombe sur 0 plutôt que NaN', () => {
    const line = ['pkC', '(none)', '1.1.1.1:1', '10.20.0.9/32', 'x', 'y', 'z', 'off'].join('\t');
    expect(parseWgDump(line).pkC).toMatchObject({ latestHandshake: 0, rxBytes: 0, txBytes: 0 });
  });
});
