import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';
import QRCode from 'qrcode';
import { DEFAULT_TICKET_TEMPLATE, type TicketTemplate } from './api';

// Builds a printable A4 sheet of WiFi tickets (grid of cut-out cards, each with
// its scannable QR) and hands it to the OS share/print sheet — AirPrint, PDF or
// a thermal printer. See P8 (impression) in project_mikrolan2_commercial.
// Rendering respects the router's ticket template (Paramètres du ticket).

export type PrintableTicket = { code: string };

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

export type TicketsPdfOpts = {
  routerName: string;
  planName: string;
  durationMinutes: number;
  priceXof: number;
  tickets: PrintableTicket[];
  template?: TicketTemplate | null;
};

export async function buildTicketsHtml(opts: TicketsPdfOpts): Promise<string> {
  const {
    routerName,
    planName,
    durationMinutes,
    priceXof,
    tickets,
    template: t,
  } = opts;
  const tpl = t ?? DEFAULT_TICKET_TEMPLATE;

  const createdAt = new Date().toLocaleString('fr-FR');
  const brandLine = tpl.showCompanyName && tpl.companyName ? tpl.companyName : null;

  const cards = await Promise.all(
    tickets.map(async (ticket, i) => {
      const qr = tpl.showQrCode
        ? await QRCode.toString(ticket.code, {
            type: 'svg',
            margin: 0,
            width: 60,
          })
        : '';
      return `
        <div class="ticket">
          <div class="head">
            <span class="brand">${esc(brandLine ?? (tpl.showWifiName ? (tpl.wifiName || routerName) : ''))}</span>
            ${tpl.showTicketNumber ? `<span class="num">#${i + 1}</span>` : ''}
          </div>
          ${qr ? `<div class="qr">${qr}</div>` : ''}
          <div class="code">${esc(ticket.code)}</div>
          ${
            tpl.showPlanName || tpl.showPrice
              ? `<div class="meta">${
                  tpl.showPlanName ? `${esc(planName)} · ${fmtDuration(durationMinutes)}` : ''
                }${
                  tpl.showPrice
                    ? ` ${tpl.showPlanName ? '·' : ''} ${priceXof.toLocaleString('fr-FR')} ${esc(tpl.currency)}`
                    : ''
                }</div>`
              : ''
          }
          ${tpl.showCreatedAt ? `<div class="hint">${esc(createdAt)}</div>` : ''}
          ${tpl.showNote && tpl.note ? `<div class="note">${esc(tpl.note)}</div>` : ''}
          ${tpl.showPoweredBy ? `<div class="powered">Propulsé par MikroLan2</div>` : ''}
        </div>`;
    }),
  );

  const html = `<!DOCTYPE html><html><head><meta charset="utf-8" />
  <style>
    * { box-sizing: border-box; }
    @page { size: A4; margin: 5mm; }
    body { margin: 0; font-family: -apple-system, Roboto, sans-serif; color: #0B0B12; }
    .page-header { text-align: center; font-size: 10px; font-weight: 700; padding: 2mm 0; }
    .grid { display: flex; flex-wrap: wrap; gap: 1.5mm; }
    .ticket {
      width: 38.5mm; height: 27mm; border: 1px dashed #9AA0B4; border-radius: 2mm;
      padding: 1mm; text-align: center; page-break-inside: avoid;
      overflow: hidden; line-height: 1.15;
    }
    .head { display: flex; justify-content: space-between; align-items: center;
      font-size: 4.5px; font-weight: 700; margin-bottom: 0.3mm; }
    .brand { color: #7B61FF; text-transform: uppercase; letter-spacing: .3px; }
    .num { color: #9AA0B4; }
    .qr { display: flex; justify-content: center; }
    .qr svg { width: 10mm; height: 10mm; }
    .code { font-family: monospace; font-size: 7px; font-weight: 700;
      letter-spacing: .5px; margin: 0.5mm 0 0.3mm; word-break: break-all; }
    .meta { font-size: 4.5px; color: #444; }
    .hint { font-size: 3.5px; color: #9AA0B4; margin-top: 0.3mm; }
    .note { font-size: 3.5px; color: #444; font-style: italic; margin-top: 0.3mm; }
    .powered { font-size: 3.5px; color: #9AA0B4; margin-top: 0.3mm; }
    .page-footer { text-align: center; font-size: 9px; color: #9AA0B4; padding: 2mm 0; }
    @page { counter-increment: page; }
    .page-number:after { content: counter(page); }
  </style></head>
  <body>
    ${tpl.showLogo && tpl.logoDataUri ? `<div style="text-align:center;padding-top:10px"><img src="${tpl.logoDataUri}" style="height:48px" /></div>` : ''}
    ${tpl.showHeader && tpl.header ? `<div class="page-header">${esc(tpl.header)}</div>` : ''}
    <div class="grid">${cards.join('')}</div>
    ${tpl.showFooter && tpl.footer ? `<div class="page-footer">${esc(tpl.footer)}</div>` : ''}
    ${tpl.showPageNumber ? `<div class="page-footer">Page <span class="page-number"></span></div>` : ''}
  </body></html>`;

  return html;
}

// "Télécharger" — génère le PDF et ouvre la feuille de partage OS (enregistrer,
// envoyer, imprimer via une appli tierce).
export async function printTickets(opts: TicketsPdfOpts): Promise<void> {
  const html = await buildTicketsHtml(opts);
  const { uri } = await Print.printToFileAsync({ html });
  if (await Sharing.isAvailableAsync()) {
    await Sharing.shareAsync(uri, {
      mimeType: 'application/pdf',
      dialogTitle: 'Imprimer / partager les tickets',
    });
  }
}

// "Imprimer" — ouvre directement la boîte de dialogue d'impression OS
// (sélection imprimante Bluetooth/AirPrint), sans passer par la feuille de
// partage.
export async function printTicketsDirect(opts: TicketsPdfOpts): Promise<void> {
  const html = await buildTicketsHtml(opts);
  await Print.printAsync({ html });
}
