import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { SubscriptionService } from '../subscriptions/subscriptions.service';
import { LocationService } from '../locations/location.service';
import { MANAGER_SELECT } from '../locations/location.types';
import type { LocationConfig } from '../locations/location.types';
import type { Prisma } from '../../../generated/prisma/client';

type BranchRow = Prisma.BranchGetPayload<{
  include: { manager: { select: typeof MANAGER_SELECT } };
}>;

/** Everything that makes a branch a branch rather than a warehouse. */
const BRANCH_CONFIG: LocationConfig = {
  quotaField: 'quotaSnapshotMaxBranches',
  postingField: 'branchId',
  otherPostingField: 'warehouseId',
  messages: {
    notFound: 'Không tìm thấy chi nhánh',
    alreadyDeleted: 'Chi nhánh đã bị xoá',
    quotaLabel: 'số chi nhánh',
    staffStillAttached: (count) =>
      `Không thể xoá chi nhánh khi còn ${count} nhân viên đang trực thuộc. Hãy chuyển họ sang chi nhánh khác trước.`,
    staffNotEligible:
      'Người được bổ nhiệm phải là nhân viên đang hoạt động của cửa hàng',
    staffPostedElsewhere:
      'Nhân viên này đang trực thuộc một nơi làm việc khác. Hãy chuyển họ về chi nhánh này trước khi bổ nhiệm.',
  },
};

// Ported from iKiotMS-BE's BranchService + BranchController. List/detail/create/update/
// soft-delete and the manager appointment all live in LocationService, which WarehouseService
// shares — the two were 90% identical text before, which is exactly how they drifted apart
// in the old codebase. Anything genuinely branch-specific belongs here.
@Injectable()
export class BranchService extends LocationService<BranchRow> {
  constructor(prisma: PrismaService, subscriptions: SubscriptionService) {
    super(prisma, subscriptions, prisma.branch, BRANCH_CONFIG);
  }

  /** Thin wrapper so the response keeps the `branchId` key the old API returned. */
  async assignManager(tenantId: string, branchId: string, staffId: string) {
    const manager = await this.appointManager(tenantId, branchId, staffId);
    return { branchId, manager };
  }
}
