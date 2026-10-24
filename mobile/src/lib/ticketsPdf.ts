import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';
import * as FileSystem from 'expo-file-system/legacy';
import { buildTicketsHtml, type TicketsPdfOpts } from './ticketHtml';
import { reportSilent } from './report';

export { buildTicketsHtml, type PrintableTicket, type TicketsPdfOpts } from './ticketHtml';

const DIACRITICS_RE = new RegExp('[̀-ͯ]', 'g');
function slug(s: string): string {
  return s
    .normalize('NFD')
    .replace(DIACRITICS_RE, '')
    .replace(/[^a-zA-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

export function buildPdfFileName(opts: {
  planName: string;
  batchSeq?: number;
  date: Date;
}): string {
  const d = opts.date;
  const yyyy = d.getFullYear();
  const MM = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  const plan = slug(opts.planName).replace(/_/g, '') || 'Forfait';
  const lot = opts.batchSeq != null ? `Lot${opts.batchSeq}` : 'Lot';
  return `Mikrolan_${plan}_${yyyy}-${MM}-${dd}_${lot}.pdf`;
}

// expo-print ignore `@page { size: A4 }` sur Android et sort du Letter (612×792) par défaut.
const A4_POINTS = { width: 595, height: 842 } as const;

export async function printTickets(opts: TicketsPdfOpts): Promise<void> {
  try {
    const html = await buildTicketsHtml(opts);
    const { uri } = await Print.printToFileAsync({ html, ...A4_POINTS });
    const fileName = buildPdfFileName({
      planName: opts.planName,
      batchSeq: opts.batchSeq,
      date: opts.batchDate ? new Date(opts.batchDate) : new Date(),
    });
    const target = `${FileSystem.cacheDirectory}${fileName}`;
    await FileSystem.deleteAsync(target, { idempotent: true });
    await FileSystem.moveAsync({ from: uri, to: target });
    if (await Sharing.isAvailableAsync()) {
      await Sharing.shareAsync(target, { mimeType: 'application/pdf', dialogTitle: fileName });
    }
  } catch (err) {
    reportSilent('ticketsPdf.print', err, { routerName: opts.routerName, ticketCount: opts.tickets.length });
    throw err;
  }
}

export async function printTicketsDirect(opts: TicketsPdfOpts): Promise<void> {
  try {
    const html = await buildTicketsHtml(opts);
    await Print.printAsync({ html });
  } catch (err) {
    reportSilent('ticketsPdf.printDirect', err, { routerName: opts.routerName, ticketCount: opts.tickets.length });
    throw err;
  }
}
