import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import * as bcrypt from 'bcryptjs';
import { PrismaService } from '../../prisma/prisma.service';
import { NotificationService } from '../notifications/notifications.service';
import { SubscriptionService } from '../subscriptions/subscriptions.service';
import { StaffNotificationTemplates } from '../notifications/templates/staff.templates';
import { UserStatus } from '../../common/constants/user-status';
import { SystemRole } from '../../common/constants/system-role';
import { paginate, skipFor } from '../../common/utils/pagination';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { QueryUserDto } from './dto/query-user.dto';
import {
  DeleteStaffDto,
  LeaveBalanceDto,
  StaffAccountPasswordDto,
} from './dto/staff-account.dto';
import { validateVietnamIdentificationId } from './vietnam-identification';
import { validateVietnamPhoneNumber } from './vietnam-phone';
import type { Prisma } from '../../../generated/prisma/client';

const BCRYPT_COST = 10;
const SELECT_SAFE = {
  id: true,
  tenantId: true,
  email: true,
  phoneNumber: true,
  systemRole: true,
  roleId: true,
  role: { select: { id: true, name: true } },
  status: true,
  branchId: true,
  warehouseId: true,
  profileFirstName: true,
  profileLastName: true,
  profileAvatarUrl: true,
  profileDob: true,
  profileTaxNumber: true,
  profileIdentificationId: true,
  profileAddress: true,
  profileGender: true,
  hireDate: true,
  paysheetId: true,
  accountNote: true,
  lastLogin: true,
  createdAt: true,
  leaveBalanceAnnualDays: true,
  leaveBalanceRemainingDays: true,
} as const;

/** A leave request still "in force": it hasn't been rejected and hasn't finished yet. */
const LIVE_LEAVE_STATUSES = ['PENDING', 'APPROVED'];

/**
 * Staff accounts. Covers iKiotMS-BE's whole `/staff` module: the CRUD half was ported on
 * 2026-08-17, and the account-lifecycle and leave-balance half on 2026-08-25.
 *
 * A large part of the old service was role-hierarchy plumbing — who may edit whom, given
 * BRANCH_MANAGER vs WAREHOUSE_MANAGER vs STAFF. None of that survives: those roles are gone
 * (see CLAUDE.md "Authorization"), and "who may edit staff" is now one permission,
 * `users:update`, which the tenant grants to whichever custom role it likes.
 */
@Injectable()
export class UserService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationService,
    private readonly subscriptions: SubscriptionService,
  ) {}

  /**
   * The staff list, paginated and filtered — a port of iKiotMS-BE's `getStaffList`, which
   * the first NestJS pass had reduced to "every user in the tenant, unbounded".
   *
   * Two rules carried over from the old filter and worth keeping in mind:
   *  - **only STAFF accounts appear.** The old `getStaffFilter` matched `role in
   *    STAFF_ROLES`, so the tenant owner was never in their own staff list.
   *  - **the caller is excluded.** Also the old behaviour (`_id: { $ne: userId }`) — this
   *    screen is for managing other people.
   */
  async findAll(tenantId: string, requesterId: string, query: QueryUserDto) {
    const where: Prisma.UserWhereInput = {
      tenantId,
      systemRole: SystemRole.STAFF,
      status: query.status ?? { not: UserStatus.DELETED },
      id: { not: requesterId },
    };

    if (query.roleId) where.roleId = query.roleId;
    if (query.branchId) where.branchId = query.branchId;
    if (query.warehouseId) where.warehouseId = query.warehouseId;

    if (query.search) {
      const match = { contains: query.search, mode: 'insensitive' } as const;
      where.OR = [
        { email: match },
        { phoneNumber: match },
        { profileFirstName: match },
        { profileLastName: match },
      ];
    }

    const [data, total] = await Promise.all([
      this.prisma.user.findMany({
        where,
        select: SELECT_SAFE,
        orderBy: { createdAt: 'desc' },
        skip: skipFor(query.page, query.limit),
        take: query.limit,
      }),
      this.prisma.user.count({ where }),
    ]);

    return paginate(data, total, query.page, query.limit);
  }

  async findOne(tenantId: string, id: string) {
    const user = await this.prisma.user.findFirst({
      where: { id, tenantId },
      select: SELECT_SAFE,
    });
    if (!user) throw new NotFoundException('User not found');
    return user;
  }

  /**
   * Hire someone. Creates the employee **INACTIVE and without a password** — giving them a
   * login is `POST /users/:id/account`, a separate call. See `CreateUserDto` for why.
   */
  async create(tenantId: string, dto: CreateUserDto) {
    await this.assertRoleBelongsToTenant(tenantId, dto.roleId);
    await this.assertWorkplaceBelongsToTenant(
      tenantId,
      dto.branchId,
      dto.warehouseId,
    );

    // Seats are what a plan actually sells, so this has to be checked before the row is
    // written, not when the login is switched on: a shop that could add unlimited employee
    // records and only pay for the ones that sign in is not on a per-seat plan at all.
    // Counts the same population the list screen shows — STAFF, not yet deleted.
    await this.subscriptions.assertQuota(
      tenantId,
      'quotaSnapshotMaxUsers',
      () =>
        this.prisma.user.count({
          where: {
            tenantId,
            systemRole: SystemRole.STAFF,
            status: { not: UserStatus.DELETED },
          },
        }),
      'số nhân viên',
    );

    const phoneNumber = validateVietnamPhoneNumber(dto.phoneNumber);
    // Not tenant-scoped: the phone number is the login handle for the whole platform.
    const existingPhone = await this.prisma.user.findFirst({
      where: { phoneNumber },
    });
    if (existingPhone) {
      throw new ConflictException('Số điện thoại đã tồn tại');
    }

    // The same check `update` runs. It used to run only there, so two colleagues could be
    // created on one email address and the clash only surfaced when somebody later edited
    // one of them — by which time both had orders and payslips against them.
    await this.assertContactDetailsAreFree(tenantId, null, {
      email: dto.email,
    });

    const user = await this.prisma.user.create({
      data: {
        tenantId,
        phoneNumber,
        email: dto.email,
        password: null,
        systemRole: SystemRole.STAFF,
        roleId: dto.roleId,
        branchId: dto.branchId,
        warehouseId: dto.warehouseId,
        profileFirstName: dto.firstName,
        profileLastName: dto.lastName,
        status: UserStatus.INACTIVE,
      },
      select: SELECT_SAFE,
    });
    return user;
  }

  /**
   * Edit a staff record. Ported from iKiotMS-BE's `updateStaff`, which the first NestJS
   * pass had cut down to four fields — the profile, hire date, pay scheme and account note
   * had no way in at all.
   *
   * Everything about the account's *lifecycle* stays out of here; see UpdateUserDto.
   */
  async update(tenantId: string, id: string, dto: UpdateUserDto) {
    const current = await this.requireStaff(tenantId, id);

    if (dto.roleId) await this.assertRoleBelongsToTenant(tenantId, dto.roleId);
    const posting = this.resolvePosting(dto);
    await this.assertWorkplaceBelongsToTenant(
      tenantId,
      posting.branchId ?? undefined,
      posting.warehouseId ?? undefined,
    );
    if (dto.paysheetId) {
      await this.assertPaysheetIsUsable(tenantId, dto.paysheetId);
    }

    const identificationId = this.resolveIdentificationId(current, dto);
    await this.assertContactDetailsAreFree(tenantId, id, {
      email: dto.email,
      identificationId: dto.profile?.identificationId
        ? identificationId
        : undefined,
    });

    return this.prisma.user.update({
      where: { id },
      data: {
        email: dto.email,
        roleId: dto.roleId,
        ...posting,
        hireDate: dto.hireDate ? new Date(dto.hireDate) : undefined,
        paysheetId: dto.paysheetId,
        accountNote: dto.accountNote,
        profileFirstName: dto.profile?.firstName,
        profileLastName: dto.profile?.lastName,
        profileAvatarUrl: dto.profile?.avatarUrl,
        profileDob: dto.profile?.dob ? new Date(dto.profile.dob) : undefined,
        profileTaxNumber: dto.profile?.taxNumber,
        profileIdentificationId: dto.profile?.identificationId
          ? identificationId
          : undefined,
        profileAddress: dto.profile?.address,
        profileGender: dto.profile?.gender,
      },
      select: SELECT_SAFE,
    });
  }

  /**
   * A staff member is posted at exactly one location, so naming one clears the other.
   *
   * Ported from `normalizeWorkplaceUpdateData`: without it, a client that sends only
   * `branchId` leaves a stale `warehouseId` behind and the row claims two workplaces —
   * which `validateSingleWorkplaceAssignment` then rejected on the *next* edit, blaming
   * whoever touched it last.
   */
  private resolvePosting(dto: UpdateUserDto): {
    branchId?: string | null;
    warehouseId?: string | null;
  } {
    if (dto.branchId !== undefined && dto.warehouseId !== undefined) {
      throw new BadRequestException(
        'Nhân viên chỉ được trực thuộc một chi nhánh hoặc một kho',
      );
    }
    if (dto.branchId !== undefined) {
      return { branchId: dto.branchId, warehouseId: null };
    }
    if (dto.warehouseId !== undefined) {
      return { warehouseId: dto.warehouseId, branchId: null };
    }
    return {};
  }

  /**
   * The citizen ID has to agree with the birth date and sex on the same record, and either
   * side of that trio may be the one being edited — so the check runs against the merged
   * result, not against the request alone. Ported from the same three-field condition in
   * the old `updateStaff`.
   */
  private resolveIdentificationId(
    current: {
      profileIdentificationId: string | null;
      profileDob: Date | null;
      profileGender: string | null;
    },
    dto: UpdateUserDto,
  ): string | undefined {
    const next =
      dto.profile?.identificationId ?? current.profileIdentificationId;
    if (!next) return undefined;

    const touched =
      dto.profile !== undefined &&
      ('identificationId' in dto.profile ||
        'dob' in dto.profile ||
        'gender' in dto.profile);
    if (!touched) return undefined;

    return validateVietnamIdentificationId(next, {
      dob: dto.profile?.dob ?? current.profileDob,
      gender: dto.profile?.gender ?? current.profileGender,
    });
  }

  /** A pay scheme has to exist, be in this tenant, and not be deleted. */
  private async assertPaysheetIsUsable(tenantId: string, paysheetId: string) {
    const paysheet = await this.prisma.paysheet.findFirst({
      where: { id: paysheetId, tenantId, status: 'ACTIVE' },
      select: { id: true },
    });
    if (!paysheet) {
      throw new BadRequestException('Bảng lương không tồn tại hoặc đã bị xóa');
    }
  }

  /**
   * Email and citizen ID may not collide with another staff member's.
   *
   * Both are scoped to the tenant. The old check left `identificationId` unscoped — global
   * across every tenant — which is defensible for a national ID but means one shop can
   * discover that another shop employs a particular person, so it is narrowed here.
   */
  private async assertContactDetailsAreFree(
    tenantId: string,
    /** The row being edited, excluded from the search. `null` when creating. */
    id: string | null,
    values: { email?: string; identificationId?: string },
  ) {
    // Spread rather than `id: { not: id }`: with a null id that would read as "id is not
    // null", which is every row — right by accident here, but only by accident.
    const others = id ? { id: { not: id } } : {};

    if (values.email) {
      const taken = await this.prisma.user.findFirst({
        where: {
          tenantId,
          email: values.email.toLowerCase().trim(),
          ...others,
          status: { not: UserStatus.DELETED },
        },
        select: { id: true },
      });
      if (taken) throw new ConflictException('Email đã tồn tại');
    }

    if (values.identificationId) {
      const taken = await this.prisma.user.findFirst({
        where: {
          tenantId,
          profileIdentificationId: values.identificationId,
          ...others,
          status: { not: UserStatus.DELETED },
        },
        select: { id: true },
      });
      if (taken) throw new ConflictException('Số căn cước đã tồn tại');
    }
  }

  /**
   * Soft delete, and an anonymising one.
   *
   * The row itself has to stay — orders, attendances, payslips and audit logs all hold a
   * foreign key to it — but the personal data on it does not, so identifying fields are
   * cleared and the phone number is replaced with a unique placeholder (it is the login
   * handle, and leaving it in place would block the person from ever being re-hired under
   * the same number). Ported from iKiotMS-BE's `anonymizeDeletedStaff`, which the earlier
   * NestJS port had reduced to just flipping the status.
   */
  async remove(
    tenantId: string,
    id: string,
    actorId: string,
    dto: DeleteStaffDto = {},
  ) {
    const target = await this.requireStaff(tenantId, id);
    await this.assertNotHoldingHandover(tenantId, id);
    await this.assertNotAppointedManager(tenantId, id);

    await this.prisma.$transaction(async (tx) => {
      await tx.userFcmToken.deleteMany({ where: { userId: id } });
      await tx.user.update({
        where: { id },
        data: {
          status: UserStatus.DELETED,
          deletedAt: new Date(),
          deletedById: actorId,
          deletionReason: dto.deletionReason?.trim() || null,
          // Freed for reuse, and no longer a working login.
          phoneNumber: `deleted_${target.id}`,
          email: null,
          password: null,
          profileIdentificationId: null,
          profileTaxNumber: null,
          profileAddress: null,
          profileAvatarUrl: null,
        },
      });
    });

    return { success: true };
  }

  // ─── Account lifecycle ─────────────────────────────────────────────────────

  /**
   * Switch on the login for an employee who was created without one — the second half of
   * hiring, and the only way a staff account ever gets a password.
   *
   * Reached twice in a normal life: right after `POST /users`, and again after
   * `deactivateAccount` has cleared the password to park someone without deleting them.
   */
  async createAccount(
    tenantId: string,
    id: string,
    dto: StaffAccountPasswordDto,
  ) {
    const staff = await this.requireStaff(tenantId, id);
    this.assertPasswordsMatch(dto);

    if (staff.status === UserStatus.ACTIVE && staff.password) {
      throw new ConflictException('Nhân viên đã có tài khoản đăng nhập');
    }

    const user = await this.prisma.user.update({
      where: { id },
      data: {
        password: await bcrypt.hash(dto.newPassword, BCRYPT_COST),
        status: UserStatus.ACTIVE,
      },
      select: SELECT_SAFE,
    });

    await this.notifications.notify({
      tenantId,
      recipientIds: [id],
      referenceId: id,
      ...StaffNotificationTemplates.accountActivated(),
    });

    return user;
  }

  async updateAccountPassword(
    tenantId: string,
    id: string,
    dto: StaffAccountPasswordDto,
  ) {
    const staff = await this.requireStaff(tenantId, id);
    this.assertPasswordsMatch(dto);

    if (staff.status !== UserStatus.ACTIVE || !staff.password) {
      throw new BadRequestException('Tài khoản nhân viên chưa được kích hoạt');
    }

    return this.prisma.user.update({
      where: { id },
      data: { password: await bcrypt.hash(dto.newPassword, BCRYPT_COST) },
      select: SELECT_SAFE,
    });
  }

  /**
   * Turn the login off without deleting the person.
   *
   * The password is cleared as well as the status, so `JwtStrategy` rejects any token
   * already in the wild on the next request (INACTIVE is in INACTIVE_USER_STATUSES) and a
   * later reactivation has to set a fresh one.
   *
   * iKiotMS-BE also took a `replacementManagerId` here and swapped the outgoing manager
   * out in the same call. That flow is gone: managing a location is `Branch.managerId` now,
   * not a role, so this refuses instead and points at `PATCH /branches/:id/manager` — one
   * appointment rule, in one place.
   */
  async deactivateAccount(tenantId: string, id: string) {
    const staff = await this.requireStaff(tenantId, id);
    if (staff.status === UserStatus.INACTIVE) {
      throw new ConflictException('Tài khoản nhân viên đã bị vô hiệu hóa');
    }

    await this.assertNotHoldingHandover(tenantId, id);
    await this.assertNotAppointedManager(tenantId, id);

    return this.prisma.user.update({
      where: { id },
      data: { status: UserStatus.INACTIVE, password: null },
      select: SELECT_SAFE,
    });
  }

  // ─── Leave balance ─────────────────────────────────────────────────────────

  /**
   * Change the yearly allowance, keeping days already taken.
   *
   * `remainingDays` is recomputed as `new allowance - days already used` rather than
   * overwritten, so raising someone's quota mid-year doesn't hand back leave they already
   * spent. The new allowance therefore can't be lower than what they have used.
   */
  async updateLeaveBalance(tenantId: string, id: string, dto: LeaveBalanceDto) {
    const staff = await this.requireStaff(tenantId, id);
    const usedDays =
      staff.leaveBalanceAnnualDays - staff.leaveBalanceRemainingDays;

    if (usedDays < 0) {
      throw new ConflictException(
        'Dữ liệu ngày phép hiện tại không hợp lệ: số ngày còn lại lớn hơn tổng số ngày phép',
      );
    }
    if (dto.annualLeaveDays < usedDays) {
      throw new BadRequestException(
        `Số ngày phép năm không được nhỏ hơn số ngày đã sử dụng (${usedDays})`,
      );
    }

    return this.writeLeaveBalance(
      tenantId,
      id,
      staff,
      {
        annualLeaveDays: dto.annualLeaveDays,
        remainingDays: dto.annualLeaveDays - usedDays,
        usedDays,
      },
      'Cập nhật số ngày nghỉ phép năm thành công',
    );
  }

  /**
   * Set the opening balance, allowance and remaining together.
   *
   * Only valid while nothing has been taken yet — otherwise it would silently erase the
   * history of days already used, which is exactly what PATCH exists to avoid.
   */
  async createLeaveBalance(tenantId: string, id: string, dto: LeaveBalanceDto) {
    const staff = await this.requireStaff(tenantId, id);
    const usedDays =
      staff.leaveBalanceAnnualDays - staff.leaveBalanceRemainingDays;

    if (usedDays !== 0) {
      throw new ConflictException(
        'Nhân viên đã sử dụng ngày phép; dùng PATCH để đổi hạn mức mà không mất lịch sử',
      );
    }

    return this.writeLeaveBalance(
      tenantId,
      id,
      staff,
      {
        annualLeaveDays: dto.annualLeaveDays,
        remainingDays: dto.annualLeaveDays,
        usedDays: 0,
      },
      'Khởi tạo số dư ngày nghỉ phép thành công',
    );
  }

  /**
   * Writes the new balance only if it still matches what we just read.
   *
   * Two managers editing the same employee, or an edit racing an approved leave request,
   * would otherwise overwrite each other's arithmetic — the numbers are computed from the
   * current values, so a stale read produces a wrong result rather than a lost one. Same
   * conditional-`updateMany` trick `SupplierService.payDebt` uses.
   */
  private async writeLeaveBalance(
    tenantId: string,
    id: string,
    seen: { leaveBalanceAnnualDays: number; leaveBalanceRemainingDays: number },
    next: { annualLeaveDays: number; remainingDays: number; usedDays: number },
    message: string,
  ) {
    const written = await this.prisma.user.updateMany({
      where: {
        id,
        leaveBalanceAnnualDays: seen.leaveBalanceAnnualDays,
        leaveBalanceRemainingDays: seen.leaveBalanceRemainingDays,
      },
      data: {
        leaveBalanceAnnualDays: next.annualLeaveDays,
        leaveBalanceRemainingDays: next.remainingDays,
      },
    });

    if (written.count === 0) {
      throw new ConflictException(
        'Số dư ngày phép vừa thay đổi; vui lòng tải lại và thử lại',
      );
    }

    // `{ message, data, leaveBalance }` is the shape iKiotMS-BE answered with.
    return {
      message,
      data: await this.findOne(tenantId, id),
      leaveBalance: next,
    };
  }

  // ─── Shared guards ─────────────────────────────────────────────────────────

  /** The target has to be a STAFF account in this tenant that hasn't been deleted. */
  private async requireStaff(tenantId: string, id: string) {
    const staff = await this.prisma.user.findFirst({
      where: { id, tenantId, status: { not: UserStatus.DELETED } },
    });
    if (!staff) throw new NotFoundException('Không tìm thấy nhân viên');
    if (staff.systemRole !== SystemRole.STAFF) {
      throw new BadRequestException(
        'Chỉ tài khoản nhân viên mới thao tác được qua endpoint này',
      );
    }
    return staff;
  }

  private assertPasswordsMatch(dto: StaffAccountPasswordDto) {
    if (dto.newPassword !== dto.reEnterPassword) {
      throw new BadRequestException('Mật khẩu nhập lại không khớp');
    }
  }

  /**
   * Someone named as the handover contact on a leave request that hasn't finished yet is
   * the person a colleague's work is currently parked with — switching their account off
   * would leave that work with nobody.
   */
  private async assertNotHoldingHandover(tenantId: string, id: string) {
    const today = new Date();
    today.setUTCHours(0, 0, 0, 0);

    const holding = await this.prisma.leaveRequest.count({
      where: {
        tenantId,
        handoverToUserId: id,
        status: { in: LIVE_LEAVE_STATUSES },
        endDate: { gte: today },
      },
    });
    if (holding > 0) {
      throw new ConflictException(
        'Không thể vô hiệu hóa hoặc xóa nhân viên đang được chỉ định nhận bàn giao trong đơn nghỉ còn hiệu lực',
      );
    }
  }

  /**
   * A location must never be left pointing at a disabled manager. The replacement goes
   * through PATCH /branches/:id/manager (or the warehouse equivalent), which is the one
   * place that knows the appointment rules.
   */
  private async assertNotAppointedManager(tenantId: string, id: string) {
    const [branches, warehouses] = await Promise.all([
      this.prisma.branch.count({ where: { tenantId, managerId: id } }),
      this.prisma.warehouse.count({ where: { tenantId, managerId: id } }),
    ]);
    if (branches + warehouses > 0) {
      throw new ConflictException(
        'Nhân viên này đang là quản lý của một chi nhánh hoặc kho. Hãy bổ nhiệm người khác trước.',
      );
    }
  }

  private async assertRoleBelongsToTenant(tenantId: string, roleId: string) {
    const role = await this.prisma.role.findFirst({
      where: { id: roleId, tenantId },
    });
    if (!role)
      throw new BadRequestException('roleId does not belong to this tenant');
  }

  private async assertWorkplaceBelongsToTenant(
    tenantId: string,
    branchId?: string,
    warehouseId?: string,
  ) {
    if (branchId) {
      const branch = await this.prisma.branch.findFirst({
        where: { id: branchId, tenantId },
      });
      if (!branch)
        throw new BadRequestException(
          'branchId does not belong to this tenant',
        );
    }
    if (warehouseId) {
      const warehouse = await this.prisma.warehouse.findFirst({
        where: { id: warehouseId, tenantId },
      });
      if (!warehouse)
        throw new BadRequestException(
          'warehouseId does not belong to this tenant',
        );
    }
  }
}
