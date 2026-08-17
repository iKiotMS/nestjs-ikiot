import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { SystemRole } from '../constants/system-role';
import type { AuthUser } from '../types/auth-user.type';

// The tenant a request operates on is derived from the authenticated user, never taken
// from the client. Before this existed, every generated CRUD route read `?tenantId=` and
// trusted it — any authenticated user could read or write any other tenant's rows just by
// changing the query string. JwtStrategy already re-fetches `tenantId` from the database
// on every request (see jwt.strategy.ts), so the server always has the authoritative
// value; asking the client for it again was both redundant and unsafe.
//
// ADMIN is the one account kind with no tenant of its own (`User.tenantId` is null for
// platform admins), so it — and only it — may still name a tenant explicitly. Both
// helpers below accept that override and reject it for everyone else.

/**
 * Tenant filter for reads. Returns `undefined` for an ADMIN who named no tenant, meaning
 * "every tenant" — pass it straight into a `where` builder that omits the filter when
 * undefined. For everyone else it is always the caller's own tenant.
 */
export function resolveTenantScope(
  user: AuthUser,
  requested?: string,
): string | undefined {
  if (user.systemRole === SystemRole.ADMIN) return requested;
  if (requested && requested !== user.tenantId) {
    throw new ForbiddenException('Cannot access another tenant');
  }
  if (!user.tenantId) {
    throw new ForbiddenException('Account is not attached to a tenant');
  }
  return user.tenantId;
}

/**
 * Tenant for writes — same rules, but "every tenant" is not a valid answer, so an ADMIN
 * must name the tenant they are writing on behalf of.
 */
export function requireTenantId(user: AuthUser, requested?: string): string {
  const tenantId = resolveTenantScope(user, requested);
  if (!tenantId) {
    // Deliberately vague about *how* to name the tenant: the generated CRUD routes accept
    // `?tenantId=`, but the hand-ported tenant modules (users, roles, ...) don't expose an
    // override at all, so promising one there would be a lie.
    throw new BadRequestException(
      'ADMIN accounts belong to no tenant — this action must name one explicitly',
    );
  }
  return tenantId;
}
