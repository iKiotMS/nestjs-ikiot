import { SystemRole } from '../constants/system-role';

/** Populated onto `request.user` by JwtStrategy after a fresh per-request DB lookup —
 * see src/modules/auth/strategies/jwt.strategy.ts for why this isn't just decoded JWT
 * claims: permissions must reflect the tenant's current role edits, not a cached token. */
export interface AuthUser {
  userId: string;
  tenantId: string | null;
  systemRole: SystemRole;
  roleId: string | null;
  branchId: string | null;
  warehouseId: string | null;
  /** `"<resource>:<action>"` set, empty for ADMIN/TENANT_OWNER (those short-circuit before this is checked). */
  permissions: ReadonlySet<string>;
}
