import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { LOT_TICKETS_QUERY, mergePages, normalizeSearch, ticketShareText, TICKET_STATUS_LABEL } from './ticketSearch.ts';

test('texte de partage : code, forfait, durée et prix, sans identifiant interne', () => {
  const text = ticketShareText({ code: '3d1234', planName: '1 day', durationMinutes: 1440, priceXof: 300 });
  assert.match(text, /3d1234/);
  assert.match(text, /1 day \(1 jour\)/);
  assert.match(text, /300 FCFA/);
  assert.doesNotMatch(text, /uuid|id:/i);
});

test('durées lisibles : jours, heures, minutes', () => {
  const d = (m: number) => ticketShareText({ code: 'x', planName: 'p', durationMinutes: m, priceXof: 1 });
  assert.match(d(4320), /3 jours/);
  assert.match(d(120), /2 h/);
  assert.match(d(45), /45 min/);
});

test('recherche : minimum 2 caractères, espaces ignorés', () => {
  assert.equal(normalizeSearch(' a '), undefined);
  assert.equal(normalizeSearch(' 3d '), '3d');
  assert.equal(normalizeSearch(''), undefined);
});

test('fusion des pages : pas de doublon, ordre conservé', () => {
  const merged = mergePages([{ items: [{ id: 'a' }, { id: 'b' }] }, { items: [{ id: 'b' }, { id: 'c' }] }]);
  assert.deepEqual(merged.map((m) => m.id), ['a', 'b', 'c']);
});

test('les cinq états ont un libellé', () => {
  assert.equal(Object.keys(TICKET_STATUS_LABEL).length, 5);
  assert.equal(TICKET_STATUS_LABEL.GENERATED, 'Disponible');
});

test('requête paginée : cache borné à 10 pages et aucun rafraîchissement automatique en masse', () => {
  assert.equal(LOT_TICKETS_QUERY.maxPages, 10);
  assert.equal(LOT_TICKETS_QUERY.staleTime, 300_000);
  assert.equal(LOT_TICKETS_QUERY.refetchOnWindowFocus, false);
  assert.equal(LOT_TICKETS_QUERY.refetchOnReconnect, false);
});

test("l'écran applique ces réglages et laisse passer le premier tap quand le clavier est ouvert", () => {
  const src = readFileSync(join(import.meta.dirname, '..', '..', 'app', 'lot-tickets.tsx'), 'utf8');
  assert.match(src, /\.\.\.LOT_TICKETS_QUERY/);
  assert.match(src, /getPreviousPageParam: \(\) => undefined/);
  assert.match(src, /keyboardShouldPersistTaps="handled"/);
  assert.match(src, /queryKey: \['voucher-search', routerId, batchId \?\? null, debounced \?\? null\]/);
});
