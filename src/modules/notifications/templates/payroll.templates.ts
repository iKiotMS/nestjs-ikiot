import type { NotificationContent } from '../notification-content.type';

const link = (payslipId: string) => `/staffs/payroll/${payslipId}`;

/** REVIEW is the window for an employee to check their provisional figures and object. */
const review = (payslipId: string): NotificationContent => ({
  type: 'PAYSLIP_REVIEW',
  title: 'Phiếu lương tạm tính đang chờ kiểm tra',
  description:
    'Phiếu lương tạm tính đã sẵn sàng. Vui lòng kiểm tra và phản hồi trước khi được duyệt.',
  link: link(payslipId),
});

const approved = (payslipId: string): NotificationContent => ({
  type: 'PAYSLIP_APPROVED',
  title: 'Phiếu lương đã được duyệt',
  description: 'Phiếu lương kỳ này đã được duyệt.',
  link: link(payslipId),
});

const paid = (payslipId: string): NotificationContent => ({
  type: 'PAYSLIP_PAID',
  title: 'Lương đã được thanh toán',
  description: 'Lương kỳ này đã được chi trả.',
  link: link(payslipId),
});

/**
 * Notification copy for payroll. See CLAUDE.md "Notification & audit templates".
 *
 * **Only three of the five transitions notify.** RETURN_TO_DRAFT and CANCEL send the period
 * back to a state employees can't see, and "your payslip was withdrawn" isn't something
 * they can act on. Re-submitting after an edit notifies again on purpose: the figures
 * changed and are worth re-checking.
 */
export const PayrollNotificationTemplates = {
  review,
  approved,
  paid,

  /** The copy for a transition, or null when that transition tells nobody. */
  forAction(
    action: string,
  ): ((payslipId: string) => NotificationContent) | null {
    if (action === 'SUBMIT') return review;
    if (action === 'APPROVE') return approved;
    if (action === 'MARK_PAID') return paid;
    return null;
  },
};
