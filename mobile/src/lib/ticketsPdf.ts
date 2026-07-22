import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';
import QRCode from 'qrcode';

// Builds a printable A4 sheet of WiFi tickets (grid of cut-out cards, each with
// its scannable QR) and hands it to the OS share/print sheet — AirPrint, PDF or
// a thermal printer. See P8 (impression) in project_mikrolan2_commercial.

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

export async function printTickets(opts: {
  routerName: string;
  planName: string;
  durationMinutes: number;
  priceXof: number;
  tickets: PrintableTicket[];
}): Promise<void> {
  const { routerName, planName, durationMinutes, priceXof, tickets } = opts;

  const cards = await Promise.all(
    tickets.map(async (t) => {
      const qr = await QRCode.toString(t.code, {
        type: 'svg',
        margin: 0,
        width: 120,
      });
      return `
        <div class="ticket">
          <div class="head">
            <span class="brand">${esc(routerName)}</span>
            <span class="price">${priceXof.toLocaleString('fr-FR')} FCFA</span>
          </div>
          <div class="qr">${qr}</div>
          <div class="code">${esc(t.code)}</div>
          <div class="meta">${esc(planName)} · ${fmtDuration(durationMinutes)}</div>
          <div class="hint">Connectez-vous au WiFi puis saisissez ce code</div>
        </div>`;
    }),
  );

  const html = `<!DOCTYPE html><html><head><meta charset="utf-8" />
  <style>
    * { box-sizing: border-box; }
    body { margin: 0; font-family: -apple-system, Roboto, sans-serif; color: #0B0B12; }
    .grid { display: flex; flex-wrap: wrap; gap: 8px; padding: 12px; }
    .ticket {
      width: 260px; border: 1.5px dashed #9AA0B4; border-radius: 12px;
      padding: 12px; text-align: center; page-break-inside: avoid;
    }
    .head { display: flex; justify-content: space-between; align-items: center;
      font-size: 11px; font-weight: 700; margin-bottom: 6px; }
    .brand { color: #7B61FF; text-transform: uppercase; letter-spacing: .5px; }
    .price { color: #0B0B12; }
    .qr { display: flex; justify-content: center; }
    .qr svg { width: 120px; height: 120px; }
    .code { font-family: monospace; font-size: 20px; font-weight: 700;
      letter-spacing: 2px; margin: 8px 0 2px; }
    .meta { font-size: 12px; color: #444; }
    .hint { font-size: 9px; color: #9AA0B4; margin-top: 6px; }
  </style></head>
  <body><div class="grid">${cards.join('')}</div></body></html>`;

  const { uri } = await Print.printToFileAsync({ html });
  if (await Sharing.isAvailableAsync()) {
    await Sharing.shareAsync(uri, {
      mimeType: 'application/pdf',
      dialogTitle: 'Imprimer / partager les tickets',
    });
  }
}
