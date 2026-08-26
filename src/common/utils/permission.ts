import { CUSTOMER_PERMISSIONS, SystemRole } from '../constants/system-role';
import type { AuthUser } from '../types/auth-user.type';

/**
 * Does this account hold `resource:action`?
 *
 * The same rule `PermissionsGuard` enforces at the door, extracted so a service can ask the
 * question too. Some decisions can't be made by a guard: `GET /orders` is allowed for
 * anyone with `orders:read`, but *what it returns* widens to every branch only for someone
 * who also holds `orders:view_all`.
 *
 * ADMIN and TENANT_OWNER short-circuit — they are never rows in the Role table, so their
 * `permissions` set is empty and checking it would deny them everything.
 */
export function can(user: AuthUser, resource: string, action: string): boolean {
  if (
    user.systemRole === SystemRole.ADMIN ||
    user.systemRole === SystemRole.TENANT_OWNER
  ) {
    return true;
  }

  const key = `${resource}:${action}`;
  return user.systemRole === SystemRole.CUSTOMER
    ? CUSTOMER_PERMISSIONS.has(key)
    : user.permissions.has(key);
}
