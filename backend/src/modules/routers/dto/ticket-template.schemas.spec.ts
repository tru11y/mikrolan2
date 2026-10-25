import { ticketTemplateSchema } from './ticket-template.schemas';

const base = {
  showCompanyName: false,
  showWifiName: true,
  showPrice: true,
  currency: 'FCFA',
  showTicketNumber: true,
  showQrCode: false,
  showPlanName: false,
  showCreatedAt: true,
  showPoweredBy: true,
  showNote: true,
  showHeader: false,
  showFooter: false,
  showPageNumber: false,
  showLogo: false,
};

describe('ticketTemplateSchema', () => {
  it('accepte priceDurationInline (durée | prix sur une ligne)', () => {
    expect(ticketTemplateSchema.safeParse({ ...base, priceDurationInline: true }).success).toBe(true);
  });

  it("l'option reste facultative : un modèle déjà enregistré est toujours accepté", () => {
    expect(ticketTemplateSchema.safeParse(base).success).toBe(true);
  });

  it('refuse une valeur non booléenne et tout champ inconnu', () => {
    expect(ticketTemplateSchema.safeParse({ ...base, priceDurationInline: 'oui' }).success).toBe(false);
    expect(ticketTemplateSchema.safeParse({ ...base, inconnu: 1 }).success).toBe(false);
  });
});
