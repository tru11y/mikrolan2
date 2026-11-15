// MikroLan Connect — Vérifie que la matrice de statuts D0 §H est complète,
// qu'aucune entrée ne repose sur la couleur seule (icône obligatoire) et que
// chaque alias pointe vers une couleur Connect existante.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { statusMatrix, assertStatusHasIcon, type StatusKey } from '../tokens/status.ts';
import { connectColors } from '../tokens/colors.ts';

const expectedKeys: StatusKey[] = [
  'routerOnline','routerUnstable','routerOffline','routerUnknown','supervisionDown',
  'ticketReady','ticketActive','ticketExpired','ticketInvalid',
  'payPending','paySuccess','payFailed','payUnconfirmed',
  'wgActive','wgDegraded','wgDown',
  'opsHealthy','opsDegraded','opsCritical',
  'genRunning','genUnconfirmed','genPartial',
  'verifyChecking','verifyOffline',
];

test('status: toutes les clés D0 §H sont présentes', () => {
  for (const k of expectedKeys) {
    assert.ok(statusMatrix[k], `statut manquant : ${k}`);
  }
  assert.equal(Object.keys(statusMatrix).length, expectedKeys.length, 'aucun statut en trop');
});

test('status: aucune information portée uniquement par la couleur (icône obligatoire)', () => {
  for (const k of Object.keys(statusMatrix) as StatusKey[]) {
    assertStatusHasIcon(k);
    assert.ok(statusMatrix[k].fallbackLabel.length > 0, `${k} doit avoir un libellé`);
    assert.ok(statusMatrix[k].i18nKey.startsWith('status.'), `${k} doit avoir une clé i18n`);
  }
});

test('status: chaque alias pointe vers une couleur Connect existante', () => {
  for (const k of Object.keys(statusMatrix) as StatusKey[]) {
    const d = statusMatrix[k];
    assert.ok((connectColors as Record<string, string>)[d.color], `${k}.color=${d.color} inconnu`);
    assert.ok((connectColors as Record<string, string>)[d.bg], `${k}.bg=${d.bg} inconnu`);
  }
});

test('status: icônes distinctes entre warn triangle et supervisionDown bouclier', () => {
  assert.notEqual(statusMatrix.routerUnstable.icon, statusMatrix.supervisionDown.icon,
    'instable (triangle) et supervisionDown (bouclier) doivent avoir des icônes différentes');
  assert.notEqual(statusMatrix.routerOffline.icon, statusMatrix.ticketInvalid.icon,
    'offline (wifi barré ou close-circle) et invalid (ban) doivent différer');
  assert.notEqual(statusMatrix.ticketExpired.icon, statusMatrix.ticketInvalid.icon,
    'expiré (horloge) et invalide (ban) doivent différer visuellement');
});

test('status: sévérités attendues', () => {
  assert.equal(statusMatrix.opsCritical.severity, 'danger');
  assert.equal(statusMatrix.wgDown.severity, 'danger');
  assert.equal(statusMatrix.routerOnline.severity, 'success');
  assert.equal(statusMatrix.verifyChecking.severity, 'neutral');
  assert.equal(statusMatrix.genRunning.severity, 'info');
});
