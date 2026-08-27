import type { NotificationContent } from '../notification-content.type';

/**
 * Notification copy for rostering. See CLAUDE.md "Notification & audit templates".
 *
 * Deliberately says nothing about *which* shifts: a bulk assignment can create a week's
 * worth for one person, and the notification is sent once per person, so naming a date
 * would be wrong for everyone but the first. The link takes them to the roster.
 */
export const ScheduleNotificationTemplates = {
  assigned: (): NotificationContent => ({
    type: 'SCHEDULE_ASSIGNED',
    title: 'Bạn có lịch làm việc mới',
    description:
      'Quản lý vừa xếp ca cho bạn. Xem lịch làm việc để biết chi tiết.',
    link: '/staffs/schedule',
  }),
};
