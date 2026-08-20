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
};
