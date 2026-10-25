import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildTicketsHtml, qrSvg } from './ticketHtml.ts';
import { compactPreset, moveBlock, receiptPreset, resolveTicketTemplate } from './ticketTemplate.ts';

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
    currencyPosition: 'prefix' as const,
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

test('modèle ticket reçu : FCFA en suffixe par défaut', async () => {
  const html = await buildTicketsHtml({ ...base, template: receiptPreset(resolveTicketTemplate(null)) });
  assert.ok(/300\s*FCFA</.test(html));
  assert.ok(!html.includes('FCFA300'));
});

test('code du ticket en gras : graisse + trait (la monospace Android n\'a pas de gras)', async () => {
  const html = await buildTicketsHtml({ ...base, template: receiptPreset(resolveTicketTemplate(null)) });
  const codeDiv = html.match(/<div class="code[^"]*" style="([^"]*)"/)?.[1] ?? '';
  assert.ok(codeDiv.includes('font-weight:900'));
  assert.ok(codeDiv.includes('-webkit-text-stroke'));
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

const many = (n: number) => Array.from({ length: n }, (_, i) => ({ code: `1h${String(i).padStart(5, '0')}A` }));

test('modèle compact : 50 tickets = 1 page, 5 colonnes × 10 rangées, sans QR', async () => {
  const tpl = compactPreset(resolveTicketTemplate(null));
  assert.equal(tpl.columns, 5);
  assert.equal(tpl.cellHeightMm, 28);
  assert.equal(tpl.showQrCode, false);
  const html = await buildTicketsHtml({ ...base, tickets: many(50), template: tpl });
  assert.equal((html.match(/<tr>/g) ?? []).length, 10);
  assert.equal((html.match(/<td class="c">/g) ?? []).length, 50);
  assert.ok(!html.includes('page-break-after'));
  assert.ok(!html.includes('<path d="M'));
});

test('modèle compact : 51 tickets passent sur une 2e page', async () => {
  const html = await buildTicketsHtml({ ...base, tickets: many(51), template: compactPreset(resolveTicketTemplate(null)) });
  assert.equal((html.match(/page-break-after/g) ?? []).length, 1);
});

test('durée et prix sur une ligne séparés par un trait, une seule fois par ticket', async () => {
  const html = await buildTicketsHtml({ ...base, template: compactPreset(resolveTicketTemplate(null)) });
  assert.equal((html.match(/class="pd"/g) ?? []).length, 1);
  assert.equal((html.match(/class="bar"/g) ?? []).length, 1);
  assert.ok(/24H<\/span><span class="bar"><\/span><span[^>]*>300 FCFA<\/span>/.test(html));
});

test("sans l'option, durée et prix restent sur deux lignes", async () => {
  const html = await buildTicketsHtml({ ...base, template: receiptPreset(resolveTicketTemplate(null)) });
  assert.ok(!html.includes('class="pd"'));
  assert.ok(html.includes('24H<'));
});

test('option inline avec le prix masqué : la durée reste seule, sans trait', async () => {
  const tpl = { ...compactPreset(resolveTicketTemplate(null)), showPrice: false };
  const html = await buildTicketsHtml({ ...base, template: tpl });
  assert.ok(!html.includes('class="pd"'));
  assert.ok(html.includes('24H<'));
});
