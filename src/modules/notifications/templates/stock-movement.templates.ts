import type { NotificationContent } from '../notification-content.type';

const link = (requestId: string) => `/stock-movements/${requestId}`;

/**
 * Notification copy for the stock-movement domain. See CLAUDE.md "Notification & audit
 * templates" for why this lives here rather than inline in StockMovementService.
 */
export const StockMovementNotificationTemplates = {
  created: (requestId: string, movementType: string): NotificationContent => ({
    type: 'STOCK_MOVEMENT_CREATED',
    title: 'Phiếu chuyển kho mới',
    description: `Có phiếu ${movementType} mới cần bạn xử lý.`,
    link: link(requestId),
  }),

  inTransit: (requestId: string): NotificationContent => ({
    type: 'STOCK_MOVEMENT_IN_TRANSIT',
    title: 'Hàng đang được chuyển tới',
    description:
      'Một phiếu chuyển kho vừa được gửi đi, chờ bạn xác nhận nhận hàng.',
    link: link(requestId),
  }),

  received: (requestId: string): NotificationContent => ({
    type: 'STOCK_MOVEMENT_RECEIVED',
    title: 'Phiếu chuyển kho đã được nhận',
    description: 'Bên nhận đã xác nhận nhận hàng cho phiếu bạn tạo.',
    link: link(requestId),
  }),

  cancelled: (requestId: string): NotificationContent => ({
    type: 'STOCK_MOVEMENT_CANCELLED',
    title: 'Phiếu chuyển kho đã bị hủy',
    description: 'Một phiếu chuyển kho liên quan đến bạn đã bị hủy.',
    link: link(requestId),
  }),
};
