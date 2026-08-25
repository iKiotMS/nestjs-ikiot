import type { NotificationContent } from '../notification-content.type';

const vnd = (amount: number) => `${amount.toLocaleString('vi-VN')} VNĐ`;

/**
 * Notification copy for the supplier/payables domain. See CLAUDE.md "Notification & audit
 * templates" for why this lives here rather than inline in SupplierService.
 */
export const SupplierNotificationTemplates = {
  debtPaid: (
    supplierName: string,
    amount: number,
    remainingDebt: number,
  ): NotificationContent => ({
    type: 'SYSTEM',
    title: 'Thanh toán công nợ nhà cung cấp',
    description: `Đã trả nhà cung cấp ${supplierName} ${vnd(amount)}. Còn nợ ${vnd(remainingDebt)}.`,
    link: '/suppliers',
  }),

  /**
   * Sent once, on the receipt that pushes a supplier's outstanding debt past the warning
   * ratio — not on every receipt above it. Owners get this; the person receiving the goods
   * does not need a warning about the thing they are doing right now.
   */
  creditLimitWarning: (
    supplierName: string,
    outstandingDebt: number,
    creditLimit: number,
  ): NotificationContent => ({
    type: 'SYSTEM',
    title: 'Cảnh báo hạn mức công nợ',
    description: `Công nợ của nhà cung cấp ${supplierName} đã đạt ${((outstandingDebt / creditLimit) * 100).toFixed(1)}% hạn mức (${vnd(outstandingDebt)} / ${vnd(creditLimit)}).`,
    link: '/suppliers',
  }),
};
