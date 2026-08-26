import { SetMetadata } from '@nestjs/common';

export const PERMISSIONS_KEY = 'permissions';

export interface RequiredPermission {
  resource: string;
  /** Any one of these is enough — see the decorator's note. */
  actions: string[];
}

/**
 * Declares what a route requires. ADMIN and TENANT_OWNER always pass; CUSTOMER checks a
 * small fixed set; STAFF checks their assigned Role's grants. Every `resource`/`action`
 * pair must exist in PermissionCatalog — see prisma/seed.ts and
 * `node scripts/check-permissions.js`.
 *
 * **More than one action means "any of them"**, matching iKiotMS-BE's
 * `authorize(module, [a, b])`, which resolved with `actions.some(...)`. Only used where the
 * old system used it: `POST /orders/:id/pay-offline` accepted either `orders:update` or
 * `orders:pay_offline`, and requiring only the narrower one would have locked out roles
 * that were working before the port.
 */
export const Permissions = (resource: string, ...actions: string[]) =>
  SetMetadata(PERMISSIONS_KEY, {
    resource,
    actions,
  } satisfies RequiredPermission);
