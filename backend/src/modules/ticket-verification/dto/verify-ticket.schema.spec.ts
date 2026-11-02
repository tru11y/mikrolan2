import { verifyTicketSchema } from './verify-ticket.schema';

describe('verifyTicketSchema', () => {
  it('accepts a bare ticketCode', () => {
    expect(verifyTicketSchema.safeParse({ ticketCode: 'ABC123' }).success).toBe(
      true,
    );
  });

  it('trims surrounding whitespace', () => {
    const r = verifyTicketSchema.safeParse({ ticketCode: '  ABC123  ' });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.ticketCode).toBe('ABC123');
  });

  it('refuses an empty code', () => {
    expect(verifyTicketSchema.safeParse({ ticketCode: '' }).success).toBe(
      false,
    );
    expect(verifyTicketSchema.safeParse({ ticketCode: '   ' }).success).toBe(
      false,
    );
  });

  it('refuses a too-long code', () => {
    expect(
      verifyTicketSchema.safeParse({ ticketCode: 'A'.repeat(65) }).success,
    ).toBe(false);
  });

  it.each(['routerId', 'tenantId', 'hotspotId', 'userId', 'role', 'sellerId'])(
    'refuses body carrying a %s field (strict object)',
    (extra) => {
      const r = verifyTicketSchema.safeParse({
        ticketCode: 'ABC123',
        [extra]: 'anything',
      });
      expect(r.success).toBe(false);
    },
  );
});
