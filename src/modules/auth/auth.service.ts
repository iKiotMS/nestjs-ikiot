import {
  BadRequestException,
  ConflictException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcryptjs';
import { PrismaService } from '../../prisma/prisma.service';
import { SystemRole } from '../../common/constants/system-role';
import type { AuthUser } from '../../common/types/auth-user.type';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';
import { ChangePasswordDto } from './dto/change-password.dto';
import { UpdateMeDto } from './dto/update-me.dto';

const INACTIVE_STATUSES = new Set(['SUSPENDED', 'INACTIVE', 'DELETED']);
const BCRYPT_COST = 10;

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
  ) {}

  async register(dto: RegisterDto) {
    const [existingPhone, existingTenant] = await Promise.all([
      this.prisma.user.findFirst({ where: { phoneNumber: dto.phoneNumber } }),
      this.prisma.tenant.findFirst({ where: { name: dto.tenantName } }),
    ]);
    if (existingPhone)
      throw new ConflictException('Phone number is already registered');
    if (existingTenant)
      throw new ConflictException('Tenant name is already taken');

    const passwordHash = await bcrypt.hash(dto.password, BCRYPT_COST);

    const { tenant, owner } = await this.prisma.$transaction(async (tx) => {
      const tenant = await tx.tenant.create({ data: { name: dto.tenantName } });
      const owner = await tx.user.create({
        data: {
          tenantId: tenant.id,
          phoneNumber: dto.phoneNumber,
          email: dto.email,
          password: passwordHash,
          systemRole: SystemRole.TENANT_OWNER,
          status: 'ACTIVE',
          profileFirstName: dto.firstName,
          profileLastName: dto.lastName,
        },
      });
      await tx.tenant.update({
        where: { id: tenant.id },
        data: { tenantOwnerId: owner.id },
      });
      return { tenant, owner };
    });

    return {
      accessToken: this.issueAccessToken(owner.id),
      user: this.toPublicUser(owner),
      tenant,
    };
  }

  async login(dto: LoginDto) {
    const user = await this.prisma.user.findFirst({
      where: { phoneNumber: dto.phoneNumber },
    });
    if (!user || !user.password)
      throw new UnauthorizedException('Invalid phone number or password');
    if (INACTIVE_STATUSES.has(user.status))
      throw new UnauthorizedException('Invalid phone number or password');

    const matches = await bcrypt.compare(dto.password, user.password);
    if (!matches)
      throw new UnauthorizedException('Invalid phone number or password');

    await this.prisma.user.update({
      where: { id: user.id },
      data: { lastLogin: new Date() },
    });

    return {
      accessToken: this.issueAccessToken(user.id),
      user: this.toPublicUser(user),
    };
  }

  async me(userId: string) {
    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id: userId },
      include: { role: { select: { id: true, name: true } } },
    });
    return this.toPublicUser(user);
  }

  async updateMe(authUser: AuthUser, dto: UpdateMeDto) {
    const canEditFullProfile =
      authUser.systemRole === SystemRole.TENANT_OWNER ||
      authUser.systemRole === SystemRole.ADMIN;

    if (dto.email) {
      const emailTaken = await this.prisma.user.findFirst({
        where: { email: dto.email, id: { not: authUser.userId } },
      });
      if (emailTaken) throw new ConflictException('Email is already in use');
    }

    const data = canEditFullProfile
      ? {
          email: dto.email,
          profileFirstName: dto.firstName,
          profileLastName: dto.lastName,
          profileAvatarUrl: dto.avatarUrl,
          profileDob: dto.dob ? new Date(dto.dob) : undefined,
          profileAddress: dto.address,
          profileTaxNumber: dto.taxNumber,
          profileIdentificationId: dto.identificationId,
          profileGender: dto.gender,
        }
      : { profileAvatarUrl: dto.avatarUrl };

    const user = await this.prisma.user.update({
      where: { id: authUser.userId },
      data,
    });
    return this.toPublicUser(user);
  }

  async changePassword(userId: string, dto: ChangePasswordDto) {
    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id: userId },
    });
    if (!user.password)
      throw new BadRequestException('This account has no password set');

    const matches = await bcrypt.compare(dto.currentPassword, user.password);
    if (!matches)
      throw new BadRequestException('Current password is incorrect');

    const passwordHash = await bcrypt.hash(dto.newPassword, BCRYPT_COST);
    await this.prisma.user.update({
      where: { id: userId },
      data: { password: passwordHash },
    });
    // NOTE: the old system revoked every RefreshToken here to force re-login on other
    // devices. Deferred until refresh tokens are wired up in Redis.
    return { success: true };
  }

  private issueAccessToken(userId: string): string {
    return this.jwt.sign({ sub: userId });
  }

  private toPublicUser(user: Record<string, unknown>) {
    const rest = { ...user };
    delete rest.password;
    return rest;
  }
}
