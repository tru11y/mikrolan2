import { z } from 'zod';

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
