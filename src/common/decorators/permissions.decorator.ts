import { SetMetadata } from '@nestjs/common';

export const PERMISSIONS_KEY = 'permissions';

export interface RequiredPermission {
  resource: string;
  action: string;
}

/** Declares the (resource, action) pair a route requires. ADMIN and TENANT_OWNER always
 * pass; CUSTOMER checks a small fixed set; STAFF checks their assigned Role's grants.
 * `resource`/`action` must exist in PermissionCatalog — see prisma/seed.ts. */
export const Permissions = (resource: string, action: string) =>
  SetMetadata(PERMISSIONS_KEY, {
    resource,
    action,
  } satisfies RequiredPermission);
