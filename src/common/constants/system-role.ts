/** Coarse account kind. ADMIN and TENANT_OWNER are fixed, always-full-access — they are
 * never rows in the Role table. STAFF accounts hold a tenant-defined custom Role
 * (User.roleId). CUSTOMER is a separate, minimal, fixed-permission account kind, outside
 * the tenant's role-management system entirely. */
export const SystemRole = {
  ADMIN: 'ADMIN',
  TENANT_OWNER: 'TENANT_OWNER',
  CUSTOMER: 'CUSTOMER',
  STAFF: 'STAFF',
} as const;

export type SystemRole = (typeof SystemRole)[keyof typeof SystemRole];

/** Fixed, hardcoded grants for CUSTOMER accounts — never routed through Role/RolePermission. */
export const CUSTOMER_PERMISSIONS: ReadonlySet<string> = new Set([
  'profile:read',
]);
