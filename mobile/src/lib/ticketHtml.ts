import QRCode from 'qrcode';
import type { TicketBlock, TicketBlockId, TicketTemplate } from './api.ts';
import { isBlockVisible, resolveTicketTemplate, type ResolvedTicketTemplate } from './ticketTemplate.ts';

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
  /** Une seule cellule agrandie, pour l'écran de réglages. */
  preview?: boolean;
};

function fmtDateFull(d: Date): string {
  const dd = String(d.getDate()).padStart(2, '0');
  const MM = String(d.getMonth() + 1).padStart(2, '0');
  const yyyy = d.getFullYear();
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  const ss = String(d.getSeconds()).padStart(2, '0');
  return `${dd}/${MM}/${yyyy} ${hh}:${mm}:${ss}`;
}

const MM_TO_PX = 96 / 25.4;
const USER_ICON =
  '<svg viewBox="0 0 24 24" width="100%" height="100%"><circle cx="9" cy="7" r="4"/><path d="M1 21c0-5 3-8 8-8s8 3 8 8z"/><circle cx="18" cy="12" r="2.5" fill="none" stroke="#000" stroke-width="1.5"/><path d="M18 14.5V21M18 18h2" stroke="#000" stroke-width="1.5" fill="none"/></svg>';

export function qrSvg(text: string): string {
  const { modules } = QRCode.create(text, { errorCorrectionLevel: 'M' });
  const n = modules.size;
  let d = '';
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      if (modules.get(x, y)) d += `M${x} ${y}h1v1h-1z`;
    }
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="-2 -2 ${n + 4} ${n + 4}" shape-rendering="crispEdges" style="height:100%;width:auto"><path d="${d}"/></svg>`;
}

function fmtDurationFor(min: number, format: 'hours' | 'auto'): string {
  if (format === 'auto') return fmtDuration(min);
  return min % 60 === 0 ? `${min / 60}H` : `${min}MIN`;
}

function fmtDateIso(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

type CellCtx = {
  tpl: ResolvedTicketTemplate;
  routerName: string;
  planName: string;
  durationMinutes: number;
  priceXof: number;
  date: Date;
};

function blockText(id: TicketBlockId, c: CellCtx, number: number): string {
  const { tpl } = c;
  switch (id) {
    case 'header':
      return tpl.header ?? '';
    case 'companyName':
      return tpl.companyName ?? '';
    case 'number':
      return `#${number}`;
    case 'plan':
      return c.planName;
    case 'duration':
      return fmtDurationFor(c.durationMinutes, tpl.durationFormat);
    case 'price': {
      const amount = c.priceXof.toLocaleString('fr-FR');
      return tpl.currencyPosition === 'prefix'
        ? `${tpl.currency}${amount}`
        : `${amount} ${tpl.currency}`;
    }
    case 'contact':
      return tpl.wifiName || c.routerName;
    case 'createdAt':
      return tpl.dateFormat === 'iso' ? fmtDateIso(c.date) : fmtDateFull(c.date);
    case 'note':
      return tpl.note ?? '';
    case 'footer':
      return tpl.footer ?? '';
    case 'poweredBy':
      return 'Propulsé par MikroLan';
    default:
      return '';
  }
}

function renderBlock(blk: TicketBlock, c: CellCtx, code: string, number: number): string {
  const { tpl } = c;
  const base = `text-align:${blk.align}`;
  if (blk.id === 'logo') {
    if (!tpl.logoDataUri) return '';
    return `<div style="${base}"><img src="${esc(tpl.logoDataUri)}" style="height:${blk.size}pt;max-width:100%"/></div>`;
  }
  if (blk.id === 'qr') {
    return `<div style="${base};height:${blk.size}pt;margin:0.4mm 0">${qrSvg(code)}</div>`;
  }
  if (blk.id === 'code') {
    const icon = tpl.showCodeIcon ? `<span class="ico">${USER_ICON}</span>` : '';
    const box = tpl.boxedCode ? ' boxed' : '';
    return `<div class="code${box}" style="font-size:${blk.size}pt;font-weight:${blk.bold ? 900 : 400};${base}">${icon}${esc(code)}</div>`;
  }
  const text = blockText(blk.id, c, number);
  if (!text) return '';
  return `<div class="ln" style="${base};font-size:${blk.size}pt;font-weight:${blk.bold ? 700 : 400}">${esc(text)}</div>`;
}

export async function buildTicketsHtml(opts: TicketsPdfOpts): Promise<string> {
  const { routerName, planName, durationMinutes, priceXof, tickets, batchSeq, batchDate, preview } = opts;
  const tpl = resolveTicketTemplate(opts.template);

  const COLS = tpl.columns;
  const ROWS = Math.max(1, Math.floor(280 / tpl.cellHeightMm));
  const PER_PAGE = COLS * ROWS;

  const d = batchDate ? new Date(batchDate) : new Date();
  const ctx: CellCtx = { tpl, routerName, planName, durationMinutes, priceXof, date: d };
  const visible = tpl.blocks.filter((x) => isBlockVisible(tpl, x.id));

  function buildCell(ticket: PrintableTicket, number: number): string {
    return `<td class="c">${visible.map((x) => renderBlock(x, ctx, ticket.code, number)).join('')}</td>`;
  }

  const css = `*{box-sizing:border-box;margin:0;padding:0}
@page{size:A4 portrait;margin:4mm}
body{background:#fff;color:#000;font-family:Arial,Helvetica,sans-serif}
.hdr{font-size:7pt;color:#555;display:flex;justify-content:center;gap:4px;padding:1mm 0 2mm;border-bottom:0.5px solid #ccc;margin-bottom:1mm}
.hdr .sep{color:#ccc}
.g{width:100%;border-collapse:collapse;table-layout:fixed}
tr{page-break-inside:avoid;break-inside:avoid}
.c{border:0.5px solid #000;width:${100 / COLS}%;height:${tpl.cellHeightMm}mm;vertical-align:middle;padding:0.8mm 1.2mm;overflow:hidden;line-height:1.1}
.ln{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.code{font-family:'Courier New',Courier,monospace;letter-spacing:0.5px;padding:0.8mm 0 0.3mm;white-space:nowrap;position:relative}
.code.boxed{border:0.5px solid #000;padding:1mm 1mm 1mm 7mm;margin:0.6mm 0}
.code .ico{position:absolute;left:1mm;top:50%;width:5mm;height:5mm;margin-top:-2.5mm}`;

  if (preview) {
    const cellW = 202 / COLS;
    const scale = Math.min(280 / (cellW * MM_TO_PX), 320 / (tpl.cellHeightMm * MM_TO_PX));
    return `<!DOCTYPE html><html><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/>
<style>${css}
body{padding:8px}.g{width:${cellW}mm;transform:scale(${scale});transform-origin:top left}</style></head><body><table class="g"><tbody><tr>${buildCell(tickets[0] ?? { code: 'DEMO1234' }, 1)}</tr></tbody></table></body></html>`;
  }

  const headerParts = [
    `<span>${esc(routerName)}</span>`,
    batchSeq != null ? `<span>Lot #${batchSeq}</span>` : '',
    `<span>${tickets.length} tickets</span>`,
    `<span>${fmtDateFull(d)}</span>`,
  ].filter(Boolean);
  const headerHtml = `<div class="hdr">${headerParts.join('<span class="sep">·</span>')}</div>`;

  const pages: string[] = [];
  for (let p = 0; p < tickets.length; p += PER_PAGE) {
    const slice = tickets.slice(p, p + PER_PAGE);
    const trs: string[] = [];
    for (let r = 0; r < ROWS; r++) {
      const rowCells: string[] = [];
      for (let c = 0; c < COLS; c++) {
        const idx = r * COLS + c;
        rowCells.push(idx < slice.length ? buildCell(slice[idx], p + idx + 1) : '<td class="c"></td>');
      }
      if (r * COLS < slice.length) trs.push(`<tr>${rowCells.join('')}</tr>`);
    }
    const brk = p + PER_PAGE < tickets.length ? ' style="page-break-after:always"' : '';
    pages.push(`<table class="g"${brk}><tbody>${trs.join('')}</tbody></table>`);
  }

  return `<!DOCTYPE html><html><head><meta charset="utf-8"/><style>${css}</style></head><body>${headerHtml}${pages.join('')}</body></html>`;
}

