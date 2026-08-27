import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { PrismaService } from '../../../prisma/prisma.service';
import type { AuthUser } from '../../../common/types/auth-user.type';
import { SystemRole } from '../../../common/constants/system-role';
import { INACTIVE_USER_STATUSES } from '../../../common/constants/user-status';
import { ShiftSupervisorService } from '../../working-schedules/shift-supervisor.service';

interface JwtPayload {
  sub: string;
}

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(
    private readonly prisma: PrismaService,
    private readonly shiftSupervisor: ShiftSupervisorService,
  ) {
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
    if (INACTIVE_USER_STATUSES.has(user.status))
      throw new UnauthorizedException('Account is not active');

    // Whoever is running a shift right now holds a fixed extra set of permissions for as
    // long as it runs — iKiotMS-BE's `managedScheduleAccess`, resolved here for the same
    // reason the role's grants are: it has to reflect the clock on *this* request, and a
    // shift that ended two minutes ago must not still be granting anything. Returns null
    // (one indexed query) for everyone who isn't a STAFF account on a live shift.
    const supervision = await this.shiftSupervisor.resolve({
      userId: user.id,
      tenantId: user.tenantId,
      systemRole: user.systemRole,
      branchId: user.branchId,
      warehouseId: user.warehouseId,
      status: user.status,
    });

    return {
      userId: user.id,
      tenantId: user.tenantId,
      systemRole: user.systemRole as SystemRole,
      roleId: user.roleId,
      branchId: user.branchId,
      warehouseId: user.warehouseId,
      permissions: new Set([
        ...(user.role?.permissions.map((p) => `${p.resource}:${p.action}`) ??
          []),
        ...ShiftSupervisorService.keysFor(supervision),
      ]),
      shiftSupervision: supervision,
      email: user.email,
      displayName: user.profileFirstName
        ? `${user.profileFirstName} ${user.profileLastName ?? ''}`.trim()
        : null,
      phoneNumber: user.phoneNumber,
    };
  }
}
