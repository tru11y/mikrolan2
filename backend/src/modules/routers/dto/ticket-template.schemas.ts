import { z } from 'zod';

export const TICKET_BLOCK_IDS = [
  'header',
  'logo',
  'companyName',
  'number',
  'code',
  'plan',
  'duration',
  'price',
  'contact',
  'createdAt',
  'qr',
  'note',
  'footer',
  'poweredBy',
] as const;

export const ticketTemplateSchema = z
  .object({
    showCompanyName: z.boolean(),
    companyName: z.string().trim().max(60).optional(),
    showWifiName: z.boolean(),
    showPrice: z.boolean(),
    currency: z.string().trim().max(10),
    showTicketNumber: z.boolean(),
    showQrCode: z.boolean(),
    showPlanName: z.boolean(),
    showCreatedAt: z.boolean(),
    showPoweredBy: z.boolean(),
    showNote: z.boolean(),
    note: z.string().trim().max(200).optional(),
    showHeader: z.boolean(),
    header: z.string().trim().max(120).optional(),
    showFooter: z.boolean(),
    footer: z.string().trim().max(120).optional(),
    showPageNumber: z.boolean(),
    showLogo: z.boolean(),
    // data: URI (picked on-device) — kept small, no external file storage.
    logoDataUri: z.string().max(200_000).optional(),
    wifiName: z.string().trim().max(60).optional(),
    // Mise en page personnalisable — tous optionnels : les modèles déjà
    // enregistrés (sans `blocks`) continuent d'être acceptés et rendus.
    showDuration: z.boolean().optional(),
    durationFormat: z.enum(['hours', 'auto']).optional(),
    currencyPosition: z.enum(['prefix', 'suffix']).optional(),
    dateFormat: z.enum(['iso', 'fr']).optional(),
    boxedCode: z.boolean().optional(),
    showCodeIcon: z.boolean().optional(),
    columns: z.number().int().min(1).max(6).optional(),
    cellHeightMm: z.number().int().min(15).max(120).optional(),
    priceDurationInline: z.boolean().optional(),
    blocks: z
      .array(
        z
          .object({
            id: z.enum(TICKET_BLOCK_IDS),
            size: z.number().min(3).max(40),
            bold: z.boolean(),
            align: z.enum(['left', 'center', 'right']),
          })
          .strict(),
      )
      .max(TICKET_BLOCK_IDS.length)
      .optional(),
  })
  .strict();
export type TicketTemplateDto = z.infer<typeof ticketTemplateSchema>;

export const DEFAULT_TICKET_TEMPLATE: TicketTemplateDto = {
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
};
