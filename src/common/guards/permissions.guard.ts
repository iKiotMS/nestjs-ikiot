import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import {
  PERMISSIONS_KEY,
  RequiredPermission,
} from '../decorators/permissions.decorator';
import type { AuthUser } from '../types/auth-user.type';
import { CUSTOMER_PERMISSIONS, SystemRole } from '../constants/system-role';

@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<
      RequiredPermission | undefined
    >(PERMISSIONS_KEY, [context.getHandler(), context.getClass()]);
    if (!required) return true; // route didn't declare @Permissions(...) — JwtAuthGuard alone gates it

    const request = context.switchToHttp().getRequest<{ user?: AuthUser }>();
    const user = request.user;
    if (!user) throw new ForbiddenException('No authenticated user on request');

    if (
      user.systemRole === SystemRole.ADMIN ||
      user.systemRole === SystemRole.TENANT_OWNER
    )
      return true;

    const key = `${required.resource}:${required.action}`;
    const allowed =
      user.systemRole === SystemRole.CUSTOMER
        ? CUSTOMER_PERMISSIONS.has(key)
        : user.permissions.has(key);

    if (!allowed) {
      throw new ForbiddenException(`Missing permission ${key}`);
    }
    return true;
  }
}
