import { ForbiddenException } from '@nestjs/common';
import { SystemRole } from '../../common/constants/system-role';
import type { AuthUser } from '../../common/types/auth-user.type';

/**
 * Which slice of the tenant a caller's dashboard covers.
 *
 * iKiotMS-BE branched on two fixed roles here — `BRANCH_MANAGER` was pinned to
 * `user.branchId`, `WAREHOUSE_MANAGER` to `user.warehouseId`, and everyone else (owner,
 * cashier, anyone at all holding `reports:read`) saw the whole tenant and could filter it
 * with `?branchId=`. Those roles no longer exist. What replaced them across every ported
 * module is **the posting itself**: an account attached to a branch or a warehouse is
 * scoped to it, an account attached to neither sees the tenant. Same shape as
 * `AttendanceService.readScope` and `OrderService`'s branch resolution — see CLAUDE.md
 * "Authorization".
 *
 * The practical difference from the old system: a cashier posted to one branch used to see
 * every branch's revenue if anyone ever granted them `reports:read`. Now they see their own.
 */

export interface LocationScope {
  branchId?: string;
  warehouseId?: string;
}

/** True for the two account kinds that legitimately look across the whole tenant. */
function seesWholeTenant(user: AuthUser): boolean {
  return (
    user.systemRole === SystemRole.TENANT_OWNER ||
    user.systemRole === SystemRole.ADMIN
  );
}

/**
 * Scope for anything counted off `Order` — sales only ever happen at a branch.
 *
 * A warehouse posting therefore has no sales to see, and the old service said so explicitly
 * by filtering `branchId: null` against a collection where every order has one. That is
 * kept, but expressed as what it means: an impossible filter, so the answer is empty.
 * Reporting a warehouse's sales as the *whole tenant's* would be far worse than reporting
 * zero.
 */
export function orderScope(
  user: AuthUser,
  requestedBranchId?: string,
): { branchId?: string; impossible?: true } {
  if (user.branchId) {
    assertOwnLocation(requestedBranchId, user.branchId, 'chi nhánh');
    return { branchId: user.branchId };
  }
  if (user.warehouseId) return { impossible: true };
  if (!seesWholeTenant(user)) {
    // Posted nowhere and not an owner: nothing identifies a slice to show.
    throw new ForbiddenException(
      'Tài khoản chưa được phân về chi nhánh nào để xem báo cáo',
    );
  }
  return requestedBranchId ? { branchId: requestedBranchId } : {};
}

/**
 * Scope for anything counted off `CashFlow` or `Inventory`, both of which exist at branches
 * *and* warehouses.
 *
 * When an owner names both, warehouse wins — the old `_cashflowLocationFilter` checked it
 * first, and the Swagger docs promised that precedence, so it is not an accident to tidy up.
 */
export function locationScope(
  user: AuthUser,
  requestedBranchId?: string,
  requestedWarehouseId?: string,
): LocationScope {
  if (user.branchId) {
    assertOwnLocation(requestedBranchId, user.branchId, 'chi nhánh');
    return { branchId: user.branchId };
  }
  if (user.warehouseId) {
    assertOwnLocation(requestedWarehouseId, user.warehouseId, 'kho');
    return { warehouseId: user.warehouseId };
  }
  if (!seesWholeTenant(user)) {
    throw new ForbiddenException(
      'Tài khoản chưa được phân về địa điểm nào để xem báo cáo',
    );
  }
  if (requestedWarehouseId) return { warehouseId: requestedWarehouseId };
  if (requestedBranchId) return { branchId: requestedBranchId };
  return {};
}

/**
 * A posted account may pass its *own* location as the filter — the dashboard sends back
 * whatever it was showing — but naming someone else's is refused rather than quietly
 * ignored. The old service ignored it, which meant a manager could believe they were
 * looking at another branch while reading their own numbers.
 */
function assertOwnLocation(
  requested: string | undefined,
  own: string,
  label: string,
): void {
  if (requested && requested !== own) {
    throw new ForbiddenException(`Bạn chỉ xem được báo cáo của ${label} mình`);
  }
}
