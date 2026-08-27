import type { NotificationContent } from '../notification-content.type';

/**
 * Notification copy for support threads. See CLAUDE.md "Notification & audit templates" —
 * `NotificationService` stays a dispatcher, the words live here.
 *
 * The two sides of a support thread never notify symmetrically, and that asymmetry is
 * deliberate in the old system: operators live in the admin console with the ticket list
 * open, so a *system* notification is enough for them; the shop owner filed the ticket
 * and closed the laptop, so a reply has to reach their own inbox.
 */
export const TicketNotificationTemplates = {
  /** To the platform operators: a shop has opened a thread. */
  created: (
    tenantName: string,
    ticketId: string,
    title: string,
  ): NotificationContent => ({
    type: 'SYSTEM_TICKET_CREATED',
    title: 'Yêu cầu hỗ trợ mới',
    description: `Cửa hàng "${tenantName}" đã gửi yêu cầu hỗ trợ mã ${ticketId}: "${title}"`,
  }),

  /** Back to the shop's owners once support has answered. */
  replied: (title: string): NotificationContent => ({
    type: 'TICKET_REPLIED',
    title: 'Yêu cầu hỗ trợ đã được phản hồi',
    description: `Bộ phận hỗ trợ đã trả lời ticket ${title}.`.trim(),
    link: '/tickets',
  }),
};
