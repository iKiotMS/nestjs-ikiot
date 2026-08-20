import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcryptjs';
import type { DecodedIdToken } from 'firebase-admin/auth';
import { PrismaService } from '../../prisma/prisma.service';
import { SystemRole } from '../../common/constants/system-role';
import {
  INACTIVE_USER_STATUSES,
  UserStatus,
} from '../../common/constants/user-status';
import type { AuthUser } from '../../common/types/auth-user.type';
import type { AuditableLoginResponse } from '../../common/types/login-response.type';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';
import { ChangePasswordDto } from './dto/change-password.dto';
import { UpdateMeDto } from './dto/update-me.dto';
import { SendOtpDto } from './dto/send-otp.dto';
import { FirebaseLoginDto } from './dto/firebase-login.dto';
import { OtpService } from './otp.service';
import { FirebaseService } from './firebase.service';

const BCRYPT_COST = 10;

// Same wording as iKiotMS-BE's AuthService (ROLE_DENIED_MOBILE/ROLE_DENIED_WEB) —
// "mobile" is employee-only, "web" allows everyone except CUSTOMER.
const ROLE_DENIED_MOBILE = 'Ứng dụng chỉ dành cho nhân viên và quản lý';
const ROLE_DENIED_WEB = 'Tài khoản khách hàng không thể đăng nhập tại đây';

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly otp: OtpService,
    private readonly firebase: FirebaseService,
  ) {}

  sendOtp(dto: SendOtpDto) {
    return this.otp.sendOtp(dto.phoneNumber);
  }

  async register(dto: RegisterDto) {
    const [existingPhone, existingTenant] = await Promise.all([
      this.prisma.user.findFirst({ where: { phoneNumber: dto.phoneNumber } }),
      this.prisma.tenant.findFirst({ where: { name: dto.tenantName } }),
    ]);
    if (existingPhone)
      throw new ConflictException('Phone number is already registered');
    if (existingTenant)
      throw new ConflictException('Tenant name is already taken');

    // Verify the phone was confirmed via the OTP sent through /auth/send-otp before
    // creating any records — mirrors iKiotMS-BE's AuthService.register.
    this.otp.verifyOtp(dto.phoneNumber, dto.otpCode);

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
          status: UserStatus.ACTIVE,
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
    if (INACTIVE_USER_STATUSES.has(user.status))
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
    } satisfies AuditableLoginResponse;
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

  /** Logs a user in via a Google (Firebase) ID token. Resolved by the token's email —
   * there is no auto-provisioning, the account must already exist with that email set.
   * `platform` picks the role gate: "mobile" is employee-only (systemRole STAFF), "web"
   * (default) allows every account kind except CUSTOMER. */
  async firebaseLogin(dto: FirebaseLoginDto) {
    if (!this.firebase.isConfigured()) {
      throw new UnauthorizedException(
        'Đăng nhập Google chưa được cấu hình trên máy chủ',
      );
    }

    let decoded: DecodedIdToken;
    try {
      decoded = await this.firebase.verifyIdToken(dto.idToken);
    } catch {
      throw new UnauthorizedException(
        'Phiên đăng nhập Google không hợp lệ hoặc đã hết hạn',
      );
    }

    const email = (decoded.email || '').toLowerCase().trim();
    if (!email)
      throw new UnauthorizedException(
        'Tài khoản Google không có địa chỉ email',
      );
    if (decoded.email_verified === false) {
      throw new UnauthorizedException('Email Google chưa được xác thực');
    }

    const user = await this.prisma.user.findFirst({ where: { email } });
    if (!user)
      throw new UnauthorizedException(
        'Email này chưa được đăng ký trong hệ thống',
      );
    if (INACTIVE_USER_STATUSES.has(user.status)) {
      throw new UnauthorizedException('Tài khoản không hoạt động');
    }

    if (dto.platform === 'mobile') {
      if (user.systemRole !== SystemRole.STAFF)
        throw new ForbiddenException(ROLE_DENIED_MOBILE);
    } else if (user.systemRole === SystemRole.CUSTOMER) {
      throw new ForbiddenException(ROLE_DENIED_WEB);
    }

    await this.prisma.user.update({
      where: { id: user.id },
      data: { lastLogin: new Date() },
    });
    return {
      accessToken: this.issueAccessToken(user.id),
      user: this.toPublicUser(user),
    } satisfies AuditableLoginResponse;
  }

  private issueAccessToken(userId: string): string {
    return this.jwt.sign({ sub: userId });
  }

  /**
   * Strips the password hash and keeps every other field, with its type intact — the old
   * `Record<string, unknown>` signature erased the user's shape, which is why callers
   * (and AuditInterceptor) had to cast fields back one by one.
   */
  private toPublicUser<T extends { password?: string | null }>(
    user: T,
  ): Omit<T, 'password'> {
    const { password, ...rest } = user;
    return rest;
  }
}
