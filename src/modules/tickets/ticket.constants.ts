/**
 * Ported from iKiotMS-BE's `src/models/Ticket.js` enums.
 *
 * `RESOLVED` is carried over even though no route in the old system ever set it — the
 * value exists in production data's enum and the admin UI has a filter chip for it, so
 * dropping it here would be a schema change, not a cleanup.
 */
export const TicketStatus = {
  OPEN: 'OPEN',
  IN_PROGRESS: 'IN_PROGRESS',
  RESOLVED: 'RESOLVED',
  CLOSED: 'CLOSED',
} as const;

export const TICKET_STATUSES = Object.values(TicketStatus);

export const TicketPriority = {
  LOW: 'LOW',
  MEDIUM: 'MEDIUM',
  HIGH: 'HIGH',
  URGENT: 'URGENT',
} as const;

export const TICKET_PRIORITIES = Object.values(TicketPriority);

/** What `POST /tickets` stamps when the client sends no `priority`. */
export const DEFAULT_TICKET_PRIORITY = TicketPriority.MEDIUM;
