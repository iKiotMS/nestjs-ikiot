import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { PrismaService } from '../../../prisma/prisma.service';
import type { AuthUser } from '../../../common/types/auth-user.type';
import { SystemRole } from '../../../common/constants/system-role';

interface JwtPayload {
  sub: string;
}

const INACTIVE_STATUSES = new Set(['SUSPENDED', 'INACTIVE', 'DELETED']);

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(private readonly prisma: PrismaService) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: process.env.JWT_SECRET ?? '',
    });
  }

  // Re-fetches the user (and their current Role → RolePermission grants) on every
  // request rather than trusting cached JWT claims. This is deliberate, not the old
  // system's pattern: with tenant-editable roles, a permission a TENANT_OWNER just
  // revoked must take effect immediately, not after the access token expires.
  async validate(payload: JwtPayload): Promise<AuthUser> {
    const user = await this.prisma.user.findUnique({
      where: { id: payload.sub },
      include: { role: { include: { permissions: true } } },
    });

    if (!user) throw new UnauthorizedException('User not found');
    if (INACTIVE_STATUSES.has(user.status))
      throw new UnauthorizedException('Account is not active');

    return {
      userId: user.id,
      tenantId: user.tenantId,
      systemRole: user.systemRole as SystemRole,
      roleId: user.roleId,
      branchId: user.branchId,
      warehouseId: user.warehouseId,
      permissions: new Set(
        user.role?.permissions.map((p) => `${p.resource}:${p.action}`) ?? [],
      ),
      email: user.email,
      displayName: user.profileFirstName
        ? `${user.profileFirstName} ${user.profileLastName ?? ''}`.trim()
        : null,
      phoneNumber: user.phoneNumber,
    };
  }
}
