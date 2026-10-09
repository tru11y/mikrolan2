import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

// Anti-régression structurelle (P0 « mauvais routeur ») : aucun écran ne décide lui-même d'être « sur le bon LAN ».
const ALLOWED = new Set(['src/lib/lanRouting.core.ts', 'src/lib/lanRouting.ts', 'src/lib/lanBinder.ts', 'src/services/mikrotik-lan/lanScan.ts']);

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(ts|tsx)$/.test(name) && !/\.test\.ts$/.test(name)) out.push(p.split(String.fromCharCode(92)).join('/'));
  }
  return out;
}

const files = [...walk('app'), ...walk('src')];

test('aucune copie de la règle « même gateway / même /24 » hors du résolveur central', () => {
  for (const f of files) {
    if (ALLOWED.has(f)) continue;
    const src = readFileSync(f, 'utf8');
    assert.ok(!/sameSubnet24\s*\(/.test(src), `${f} : sameSubnet24 hors lanRouting`);
    assert.ok(!/creds\.host\s*===\s*wifi\./.test(src), `${f} : comparaison creds.host/wifi hors lanRouting`);
    assert.ok(!/getWifiInfo\s*\(/.test(src), `${f} : getWifiInfo hors lanRouting`);
  }
});

test("reportLanSessions reçoit TOUJOURS l'identité observée (3 arguments)", () => {
  for (const f of files) {
    const src = readFileSync(f, 'utf8');
    for (const m of src.matchAll(/reportLanSessions\(([^)]*)\)/g)) {
      if (f.endsWith('sessionSync.ts')) continue;
      assert.equal(m[1].split(',').length, 3, `${f} : reportLanSessions(${m[1]})`);
    }
  }
});

test('sessionSync ne rapporte rien sans identité observée', () => {
  const src = readFileSync('src/lib/sessionSync.ts', 'utf8');
  assert.match(src, /if \(!observedRouterIdentity\) return;/);
});

test('les opérations LAN sensibles passent par le résolveur vérifié (jamais getLocalCredentials direct)', () => {
  const sensitive: Array<[string, RegExp]> = [
    ['app/generate-vouchers.tsx', /pushVouchersLan\(/],
    ['app/router/[id].tsx', /c\.reboot\(\)/],
    ['app/router-settings.tsx', /c\.reboot\(\)/],
    ['app/router/[id].tsx', /pushWireGuardConfig\(/],
  ];
  for (const [f, re] of sensitive) {
    const src = readFileSync(f, 'utf8');
    assert.match(src, re, `${f} : opération attendue introuvable`);
    assert.ok(/resolveVerifiedLanRoute|verifiedLanCreds/.test(src), `${f} doit utiliser le résolveur vérifié`);
  }
  assert.ok(!/getLocalCredentials\(routerId\);\s*\n\s*if \(creds\) return listUserProfilesLan/.test(readFileSync('app/plans.tsx', 'utf8')));
});
