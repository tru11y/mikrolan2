import type { TicketBlock, TicketBlockId, TicketTemplate } from './api.ts';

export const DEFAULT_TICKET_TEMPLATE: TicketTemplate = {
  showCompanyName: false,
  showWifiName: true,
  showPrice: true,
  currency: 'FCFA',
  showTicketNumber: true,
  showQrCode: true,
  showPlanName: true,
  showCreatedAt: true,
  showPoweredBy: true,
  showNote: true,
  note: 'Conservez le ticket pendant le service',
  showHeader: false,
  showFooter: false,
  showPageNumber: false,
  showLogo: false,
  wifiName: undefined,
};


export type ResolvedTicketTemplate = TicketTemplate & {
  blocks: TicketBlock[];
  showDuration: boolean;
  durationFormat: 'hours' | 'auto';
  currencyPosition: 'prefix' | 'suffix';
  dateFormat: 'iso' | 'fr';
  boxedCode: boolean;
  showCodeIcon: boolean;
  columns: number;
  cellHeightMm: number;
};

type FlagKey = {
  [K in keyof TicketTemplate]-?: TicketTemplate[K] extends boolean | undefined ? K : never;
}[keyof TicketTemplate];

/** Drapeau de visibilité de chaque bloc ; `code` est toujours affiché. */
export const BLOCK_FLAG: Record<TicketBlockId, FlagKey | null> = {
  header: 'showHeader',
  logo: 'showLogo',
  companyName: 'showCompanyName',
  number: 'showTicketNumber',
  code: null,
  plan: 'showPlanName',
  duration: 'showDuration',
  price: 'showPrice',
  contact: 'showWifiName',
  createdAt: 'showCreatedAt',
  qr: 'showQrCode',
  note: 'showNote',
  footer: 'showFooter',
  poweredBy: 'showPoweredBy',
};

const b = (
  id: TicketBlockId,
  size: number,
  bold = false,
  align: TicketBlock['align'] = 'center',
): TicketBlock => ({ id, size, bold, align });

export const DEFAULT_BLOCKS: TicketBlock[] = [
  b('header', 5),
  b('logo', 14),
  b('companyName', 6, true),
  b('number', 5),
  b('contact', 6, true),
  b('code', 13, true),
  b('plan', 5.5),
  b('duration', 5.5, true),
  b('price', 5.5, true),
  b('createdAt', 5),
  b('qr', 40),
  b('note', 4.5),
  b('footer', 4.5),
  b('poweredBy', 4),
];

const BLOCK_IDS = DEFAULT_BLOCKS.map((x) => x.id);

function normalizeBlocks(blocks: TicketBlock[]): TicketBlock[] {
  const known = blocks.filter((x) => BLOCK_IDS.includes(x.id));
  const missing = DEFAULT_BLOCKS.filter((d) => !known.some((x) => x.id === d.id));
  return [...known, ...missing];
}

/**
 * Complète un modèle stocké. Sans `blocks` (modèle antérieur à la mise en
 * page personnalisable), on garde l'ancien rendu : les options qui n'étaient
 * pas rendues (n°, QR, plan, date, « propulsé par ») restent masquées plutôt
 * que d'apparaître d'un coup sur des tickets déjà en circulation.
 */
export function resolveTicketTemplate(
  t: TicketTemplate | null | undefined,
): ResolvedTicketTemplate {
  const src = t ?? DEFAULT_TICKET_TEMPLATE;
  const legacy = src.blocks === undefined;
  return {
    ...src,
    ...(legacy
      ? {
          showTicketNumber: false,
          showQrCode: false,
          showPlanName: false,
          showCreatedAt: false,
          showPoweredBy: false,
        }
      : {}),
    blocks: normalizeBlocks(src.blocks ?? DEFAULT_BLOCKS),
    showDuration: src.showDuration ?? true,
    durationFormat: src.durationFormat ?? (legacy ? 'auto' : 'hours'),
    currencyPosition: src.currencyPosition ?? 'suffix',
    dateFormat: src.dateFormat ?? 'fr',
    boxedCode: src.boxedCode ?? false,
    showCodeIcon: src.showCodeIcon ?? false,
    columns: src.columns ?? 5,
    cellHeightMm: src.cellHeightMm ?? 28,
  };
}

export function isBlockVisible(tpl: ResolvedTicketTemplate, id: TicketBlockId): boolean {
  const flag = BLOCK_FLAG[id];
  return flag === null ? true : Boolean(tpl[flag]);
}

export function moveBlock(blocks: TicketBlock[], index: number, delta: -1 | 1): TicketBlock[] {
  const target = index + delta;
  if (target < 0 || target >= blocks.length) return blocks;
  const next = [...blocks];
  [next[index], next[target]] = [next[target], next[index]];
  return next;
}

/** Modèle « ticket reçu » : numéro, code encadré avec icône, durée, prix, contact, date, QR, note, signature. */
export function receiptPreset(tpl: ResolvedTicketTemplate): ResolvedTicketTemplate {
  const style: Partial<Record<TicketBlockId, Pick<TicketBlock, 'size' | 'bold'>>> = {
    number: { size: 7, bold: true },
    code: { size: 16, bold: true },
    duration: { size: 10, bold: false },
    price: { size: 11, bold: false },
    contact: { size: 9, bold: true },
    createdAt: { size: 7, bold: false },
    qr: { size: 28, bold: false },
    note: { size: 6, bold: false },
    poweredBy: { size: 4, bold: false },
  };
  const order: TicketBlockId[] = ['number', 'code', 'duration', 'price', 'contact', 'createdAt', 'qr', 'note', 'poweredBy'];
  const ordered = [
    ...order.map((id) => tpl.blocks.find((x) => x.id === id)!),
    ...tpl.blocks.filter((x) => !order.includes(x.id)),
  ].map((x) => ({ ...x, ...style[x.id], align: 'center' as const }));
  return {
    ...tpl,
    blocks: ordered,
    showHeader: false,
    showLogo: false,
    showCompanyName: false,
    showTicketNumber: true,
    showPlanName: false,
    showDuration: true,
    showPrice: true,
    showWifiName: true,
    showCreatedAt: true,
    showQrCode: true,
    showNote: true,
    showFooter: false,
    showPoweredBy: true,
    durationFormat: 'hours',
    currencyPosition: tpl.currency === '$' ? 'prefix' : 'suffix',
    dateFormat: 'iso',
    boxedCode: true,
    showCodeIcon: true,
    columns: 4,
    // Le contenu mesure ~48,6 mm sur appareil : en dessous, la ligne grandit et la dernière rangée déborde.
    cellHeightMm: 50,
  };
}
