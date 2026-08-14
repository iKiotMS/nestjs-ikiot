import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import type { AuthUser } from '../types/auth-user.type';
import { SystemRole } from '../constants/system-role';

// Deliberately bypasses the Role/RolePermission catalog entirely — role *definitions*
// (what a custom role can do) must stay outside what any custom role can grant itself,
// otherwise a STAFF role with every catalog permission ticked could still never touch
// role management. Only ADMIN/TENANT_OWNER (never rows in the Role table) pass.
@Injectable()
export class OwnerOrAdminGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<{ user?: AuthUser }>();
    const user = request.user;
    if (
      !user ||
      (user.systemRole !== SystemRole.TENANT_OWNER &&
        user.systemRole !== SystemRole.ADMIN)
    ) {
      throw new ForbiddenException('Only the tenant owner can do this');
    }
    return true;
  }
}
