import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildTicketsHtml, qrSvg } from './ticketHtml.ts';
import { moveBlock, receiptPreset, resolveTicketTemplate } from './ticketTemplate.ts';

// node --test src/lib/ticketsPdf.test.ts

const base = {
  routerName: 'R1',
  planName: 'Forfait 1 jour',
  durationMinutes: 1440,
  priceXof: 300,
  tickets: [{ code: '1d8095291' }],
  batchDate: '2026-10-20T23:08:45',
};

test('modèle ticket reçu : numéro, code encadré, 24H, $300, contact, date ISO, note — dans l\'ordre', async () => {
  const tpl = {
    ...receiptPreset(resolveTicketTemplate(null)),
    currency: '$',
    wifiName: '#JAMBO AK 0504627740',
    note: 'Conservez le ticket pendant le service',
  };
  const html = await buildTicketsHtml({ ...base, template: tpl });
  const needles = ['#1<', '1d8095291', '24H<', '$300<', '#JAMBO AK 0504627740', '2026-10-20 23:08:45', 'Conservez le ticket'];
  const pos = needles.map((s) => html.indexOf(s));
  assert.ok(pos.every((p) => p >= 0), `manquant: ${needles.filter((_, i) => pos[i] < 0)}`);
  assert.deepEqual([...pos].sort((a, b) => a - b), pos);
  assert.ok(html.includes('boxed'));
});

test('modèle ancien sans blocks : rendu inchangé (pas de QR, pas de n°)', async () => {
  const html = await buildTicketsHtml({ ...base, template: null });
  assert.ok(html.includes('1d8095291'));
  assert.ok(html.includes('1 j<'));
  assert.ok(!html.includes('<path d="M'));
  assert.ok(!html.includes('#1<'));
});

test('QR généré et texte utilisateur échappé', async () => {
  assert.ok(qrSvg('abc').includes('<path d="M'));
  const html = await buildTicketsHtml({
    ...base,
    template: { ...resolveTicketTemplate(null), wifiName: '<b>x</b>' },
  });
  assert.ok(html.includes('&lt;b&gt;'));
  assert.ok(!html.includes('<b>x</b>'));
});

test('moveBlock échange et borne', () => {
  const b = resolveTicketTemplate(null).blocks;
  assert.equal(moveBlock(b, 0, -1), b);
  assert.equal(moveBlock(b, 0, 1)[1].id, b[0].id);
});
