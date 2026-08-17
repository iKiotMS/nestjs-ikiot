import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import type { AuthUser } from '../types/auth-user.type';
import { SystemRole } from '../constants/system-role';

// Platform-admin-only routes (audit logs, plan management, cross-tenant invoice views) —
// unlike OwnerOrAdminGuard, TENANT_OWNER does NOT pass here.
@Injectable()
export class AdminOnlyGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<{ user?: AuthUser }>();
    if (request.user?.systemRole !== SystemRole.ADMIN) {
      throw new ForbiddenException('Only a platform admin can do this');
    }
    return true;
  }
}
