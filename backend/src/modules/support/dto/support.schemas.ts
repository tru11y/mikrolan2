import { z } from 'zod';

export const createTicketSchema = z.object({
  subject: z.string().trim().min(3).max(200),
  body: z.string().trim().min(3).max(2000),
});
export type CreateTicketDto = z.infer<typeof createTicketSchema>;

export const ticketMessageSchema = z.object({
  body: z.string().trim().min(1).max(2000),
});
export type TicketMessageDto = z.infer<typeof ticketMessageSchema>;

const cursor = z.string().uuid().optional();
const limit = z.coerce.number().int().min(1).max(50).default(20);

export const listMyTicketsSchema = z.object({ cursor, limit });
export type ListMyTicketsDto = z.infer<typeof listMyTicketsSchema>;
