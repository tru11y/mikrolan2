import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';
import { DEFAULT_TICKET_TEMPLATE, type TicketTemplate } from './api';

function fmtDuration(min: number): string {
  if (min % 1440 === 0) return `${min / 1440} j`;
  if (min % 60 === 0) return `${min / 60} h`;
  return `${min} min`;
}

function esc(s: string): string {
  return s.replace(/[&<>"]/g, (c) =>
    c === '&' ? '&amp;' : c === '<' ? '&lt;' : c === '>' ? '&gt;' : '&quot;',
  );
}

const DIACRITICS_RE = new RegExp('[̀-ͯ]', 'g');
function slug(s: string): string {
  return s
    .normalize('NFD')
    .replace(DIACRITICS_RE, '')
    .replace(/[^a-zA-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

export type PrintableTicket = { code: string };

export type TicketsPdfOpts = {
  routerName: string;
  planName: string;
  durationMinutes: number;
  priceXof: number;
  tickets: PrintableTicket[];
  template?: TicketTemplate | null;
  batchSeq?: number;
  batchDate?: string;
};

export function buildPdfFileName(opts: {
  routerName: string;
  batchSeq?: number;
  ticketCount: number;
  date: Date;
}): string {
  const d = opts.date;
  const yyyy = d.getFullYear();
  const MM = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  const ss = String(d.getSeconds()).padStart(2, '0');
  const name = slug(opts.routerName) || 'WiFi';
  const lot = opts.batchSeq != null ? `_Lot${opts.batchSeq}` : '';
  return `MikroLan_${name}${lot}_${opts.ticketCount}Tickets_${yyyy}-${MM}-${dd}_${hh}-${mm}-${ss}.pdf`;
}

function fmtDateFull(d: Date): string {
  const dd = String(d.getDate()).padStart(2, '0');
  const MM = String(d.getMonth() + 1).padStart(2, '0');
  const yyyy = d.getFullYear();
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  const ss = String(d.getSeconds()).padStart(2, '0');
  return `${dd}/${MM}/${yyyy} ${hh}:${mm}:${ss}`;
}

export async function buildTicketsHtml(opts: TicketsPdfOpts): Promise<string> {
  const {
    routerName,
    durationMinutes,
    priceXof,
    tickets,
    template: t,
    batchSeq,
    batchDate,
  } = opts;
  const tpl = t ?? DEFAULT_TICKET_TEMPLATE;

  const COLS = 5;
  const ROWS = 10;
  const PER_PAGE = COLS * ROWS;

  const line1 = tpl.showWifiName ? esc(tpl.wifiName || routerName) : '';
  const line3 = `${fmtDuration(durationMinutes)} - ${priceXof.toLocaleString('fr-FR')} ${esc(tpl.currency)}`;
  const line4 = tpl.showNote && tpl.note ? esc(tpl.note) : '';
  const line5 = tpl.showFooter && tpl.footer ? esc(tpl.footer) : '';

  const d = batchDate ? new Date(batchDate) : new Date();
  const headerParts = [
    `<span>${esc(routerName)}</span>`,
    batchSeq != null ? `<span>Lot #${batchSeq}</span>` : '',
    `<span>${tickets.length} tickets</span>`,
    `<span>${fmtDateFull(d)}</span>`,
  ].filter(Boolean);
  const headerHtml = `<div class="hdr">${headerParts.join('<span class="sep">·</span>')}</div>`;

  function buildCell(ticket: PrintableTicket): string {
    return `<td class="c">${
      line1 ? `<div class="l1">${line1}</div>` : ''
    }<div class="code">${esc(ticket.code)}</div><div class="l3">${line3}</div>${
      line4 ? `<div class="l4">${line4}</div>` : ''
    }${
      line5 ? `<div class="l5">${line5}</div>` : ''
    }</td>`;
  }

  const pages: string[] = [];
  for (let p = 0; p < tickets.length; p += PER_PAGE) {
    const slice = tickets.slice(p, p + PER_PAGE);
    const trs: string[] = [];
    for (let r = 0; r < ROWS; r++) {
      const rowCells: string[] = [];
      for (let c = 0; c < COLS; c++) {
        const idx = r * COLS + c;
        if (idx < slice.length) rowCells.push(buildCell(slice[idx]));
        else rowCells.push('<td class="c"></td>');
      }
      if (r * COLS < slice.length) trs.push(`<tr>${rowCells.join('')}</tr>`);
    }
    const brk = p + PER_PAGE < tickets.length ? ' style="page-break-after:always"' : '';
    pages.push(`<table class="g"${brk}><tbody>${trs.join('')}</tbody></table>`);
  }

  return `<!DOCTYPE html><html><head><meta charset="utf-8"/>
<style>
*{box-sizing:border-box;margin:0;padding:0}
@page{size:A4 portrait;margin:4mm}
body{background:#fff;color:#000}
.hdr{font-family:Arial,Helvetica,sans-serif;font-size:7pt;color:#555;display:flex;justify-content:center;gap:4px;padding:1mm 0 2mm;border-bottom:0.5px solid #ccc;margin-bottom:1mm}
.hdr .sep{color:#ccc}
.g{width:100%;border-collapse:collapse;table-layout:fixed}
.c{border:0.5px solid #000;width:20%;height:28mm;text-align:center;vertical-align:middle;padding:0.3mm 0.8mm;overflow:hidden;line-height:1.05}
.l1{font-family:Arial,Helvetica,sans-serif;font-size:6pt;font-weight:700;text-transform:uppercase;letter-spacing:0.3px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.code{font-family:'Courier New',Courier,monospace;font-size:13pt;font-weight:900;letter-spacing:0.5px;padding:0.8mm 0 0.3mm;white-space:nowrap}
.l3{font-family:Arial,Helvetica,sans-serif;font-size:5.5pt;font-weight:700}
.l4{font-family:Arial,Helvetica,sans-serif;font-size:4.5pt;margin-top:0.2mm;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.l5{font-family:Arial,Helvetica,sans-serif;font-size:4.5pt;color:#333;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
</style></head><body>${headerHtml}${pages.join('')}</body></html>`;
}

export async function printTickets(opts: TicketsPdfOpts): Promise<void> {
  const html = await buildTicketsHtml(opts);
  const { uri } = await Print.printToFileAsync({ html });
  if (await Sharing.isAvailableAsync()) {
    await Sharing.shareAsync(uri, {
      mimeType: 'application/pdf',
      dialogTitle: buildPdfFileName({
        routerName: opts.routerName,
        batchSeq: opts.batchSeq,
        ticketCount: opts.tickets.length,
        date: opts.batchDate ? new Date(opts.batchDate) : new Date(),
      }),
    });
  }
}

export async function printTicketsDirect(opts: TicketsPdfOpts): Promise<void> {
  const html = await buildTicketsHtml(opts);
  await Print.printAsync({ html });
}
