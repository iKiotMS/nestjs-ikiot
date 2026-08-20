import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { SubscriptionService } from '../subscriptions/subscriptions.service';
import { LocationService } from '../locations/location.service';
import { MANAGER_SELECT } from '../locations/location.types';
import type { LocationConfig } from '../locations/location.types';
import type { Prisma } from '../../../generated/prisma/client';

type WarehouseRow = Prisma.WarehouseGetPayload<{
  include: { manager: { select: typeof MANAGER_SELECT } };
}>;

/** Everything that makes a warehouse a warehouse rather than a branch. */
const WAREHOUSE_CONFIG: LocationConfig = {
  quotaField: 'quotaSnapshotMaxWarehouses',
  postingField: 'warehouseId',
  otherPostingField: 'branchId',
  messages: {
    notFound: 'Không tìm thấy kho',
    alreadyDeleted: 'Kho đã bị xoá',
    quotaLabel: 'số kho',
    staffStillAttached: (count) =>
      `Không thể xoá kho khi còn ${count} nhân viên đang trực thuộc. Hãy chuyển họ sang nơi làm việc khác trước.`,
    staffNotEligible:
      'Người được bổ nhiệm phải là nhân viên đang hoạt động của cửa hàng',
    staffPostedElsewhere:
      'Nhân viên này đang trực thuộc một nơi làm việc khác. Hãy chuyển họ về kho này trước khi bổ nhiệm.',
  },
};

/**
 * Ported from iKiotMS-BE's WarehouseService + WarehouseController, then brought in line
 * with BranchService: a tenant runs several warehouses now, so a warehouse gets the same
 * treatment a branch does — contact details, a plan quota, and an appointment rule that
 * refuses to take a staff member away from a location they already belong to.
 *
 * That last rule is why the shared LocationService exists. The old WarehouseService
 * accepted any active staff member in the tenant, unlike its branch counterpart; that was
 * safe only while a tenant had a single warehouse. With one implementation, a rule can no
 * longer be added to one of the pair and forgotten on the other.
 */
@Injectable()
export class WarehouseService extends LocationService<WarehouseRow> {
  constructor(prisma: PrismaService, subscriptions: SubscriptionService) {
    super(prisma, subscriptions, prisma.warehouse, WAREHOUSE_CONFIG);
  }

  /** Thin wrapper so the response keeps the `warehouseId` key the old API returned. */
  async assignManager(tenantId: string, warehouseId: string, staffId: string) {
    const manager = await this.appointManager(tenantId, warehouseId, staffId);
    return { warehouseId, manager };
  }
}
