import type { NotificationContent } from '../notification-content.type';

/**
 * Notification copy for the staff-account domain. See CLAUDE.md "Notification & audit
 * templates" for why this lives here rather than inline in UserService.
 */
export const StaffNotificationTemplates = {
  /**
   * Sent to the employee whose login was just switched on.
   *
   * **Never put the password in here.** The notification is written to the database and
   * pushed over the socket (and FCM later) — that is two places outside our control, for a
   * secret the manager already has in front of them. The old system was careful about this
   * too; the comment is repeated because it is the kind of thing a "helpful" edit adds.
   */
  accountActivated: (): NotificationContent => ({
    type: 'STAFF_ACCOUNT_CREATED',
    title: 'Tài khoản của bạn đã được kích hoạt',
    description: 'Bạn đã có thể đăng nhập vào hệ thống iKiot.',
    link: '/dashboard',
  }),
};
