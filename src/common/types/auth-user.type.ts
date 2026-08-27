import { SystemRole } from '../constants/system-role';

/**
 * Temporary rights held by whoever is running a shift right now — iKiotMS-BE's
 * `managedScheduleAccess`. Resolved per request by `ShiftSupervisorService`; `null` for
 * everyone not currently supervising. It expires by the clock, so there is nothing to
 * revoke.
 */
export interface ShiftSupervisorAccess {
  scheduleIds: string[];
  /** Locations the supervision reaches — the shift's, intersected with their own posting. */
  branchIds: string[];
  warehouseIds: string[];
  startsAt: Date;
  endsAt: Date;
}

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
  /** `"<resource>:<action>"` set, empty for ADMIN/TENANT_OWNER (those short-circuit before this is checked).
   *  Includes anything a live shift supervision adds — see `shiftSupervision`. */
  permissions: ReadonlySet<string>;
  /** Non-null only while this account is running a shift. Location-scoped: `permissions`
   *  says *what* the shift allows, this says *where*. Both halves are required — see
   *  `supervisesLocation`. */
  shiftSupervision: ShiftSupervisorAccess | null;
  /** Carried along only so AuditInterceptor doesn't need a second query for the common
   * (already-authenticated) case — not used by any permission check. */
  email: string | null;
  displayName: string | null;
  phoneNumber: string;
}
