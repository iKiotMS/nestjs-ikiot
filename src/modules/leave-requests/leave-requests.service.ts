import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { NotificationService } from '../notifications/notifications.service';
import { LeaveRequestNotificationTemplates } from '../notifications/templates/leave-request.templates';
import { SystemRole } from '../../common/constants/system-role';
import {
  INACTIVE_USER_STATUSES,
  UserStatus,
} from '../../common/constants/user-status';
import { can } from '../../common/utils/permission';
import { paginate, skipFor } from '../../common/utils/pagination';
import type { AuthUser } from '../../common/types/auth-user.type';
import type { NotificationContent } from '../notifications/notification-content.type';
import { ScheduleStatus } from '../working-schedules/working-schedule.constants';
import { leaveDate, leaveDayCount, nextDay } from './leave-date';
import {
  DEFAULT_ANNUAL_LEAVE_DAYS,
  LeaveRequestStatus,
  LIVE_LEAVE_STATUSES,
} from './leave-request.constants';
import {
  CreateEmergencyLeaveRequestDto,
  CreateLeaveRequestDto,
  PreviewHandoverDto,
  QueryLeavePerDayDto,
  QueryLeaveRequestDto,
  ReviewLeaveRequestDto,
} from './dto/leave-request.dto';
import type { Prisma } from '../../../generated/prisma/client';

const REQUESTER_SELECT = {
  id: true,
  email: true,
  phoneNumber: true,
  profileFirstName: true,
  profileLastName: true,
  branchId: true,
  warehouseId: true,
  branch: { select: { id: true, name: true } },
  warehouse: { select: { id: true, name: true } },
} as const;

const REQUEST_INCLUDE = {
  user: { select: REQUESTER_SELECT },
  approvedBy: {
    select: {
      id: true,
      profileFirstName: true,
      profileLastName: true,
      phoneNumber: true,
    },
  },
  handoverToUser: {
    select: { id: true, profileFirstName: true, profileLastName: true },
  },
  handoverSchedules: { select: { scheduleId: true } },
} as const satisfies Prisma.LeaveRequestInclude;

type RequestRow = Prisma.LeaveRequestGetPayload<{
  include: typeof REQUEST_INCLUDE;
}>;

/**
 * Leave requests — iKiotMS-BE's `leaveRequest` module.
 *
 * Two things make this more than CRUD, and both are about money and cover:
 *
 * 1. **Approving spends the employee's annual allowance.** `paidLeaveDays` comes off
 *    `User.leaveBalanceRemainingDays` inside the approval transaction, with a conditional
 *    update so two approvals can't overdraw it, and goes back on if the leave is cancelled.
 * 2. **A shift supervisor going on leave has to hand their shifts over.** Any
 *    `WorkingSchedule` they manage inside the leave window moves to the person named in
 *    `handoverToUserId`; cancelling moves them back.
 *
 * **"Manager" is a substitution.** The old service asked `role in (BRANCH_MANAGER,
 * WAREHOUSE_MANAGER)` in four places to decide whether handover applied. Those roles are
 * gone, so the question becomes the one that was actually being asked: **does this person
 * manage any shifts in the window?** That is more precise than the role check ever was —
 * a branch manager with no shifts in the window needed no handover either.
 *
 * `deleteLeaveRequest` is not ported: it existed in the old service but no route reached
 * it, and it neither restored the balance nor undid the handover.
 */
@Injectable()
export class LeaveRequestService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationService,
  ) {}

  // ─── Reads ─────────────────────────────────────────────────────────────────

  async findAll(user: AuthUser, query: QueryLeaveRequestDto) {
    const tenantId = this.tenantOf(user);
    const where = this.buildWhere(tenantId, query, this.readScope(user));

    const [rows, total] = await Promise.all([
      this.prisma.leaveRequest.findMany({
        where,
        include: REQUEST_INCLUDE,
        orderBy: { createdAt: 'desc' },
        skip: skipFor(query.page, query.limit),
        take: query.limit,
      }),
      this.prisma.leaveRequest.count({ where }),
    ]);

    return paginate(
      rows.map((row) => this.toResponse(row)),
      total,
      query.page,
      query.limit,
    );
  }

  async findMine(user: AuthUser, query: QueryLeaveRequestDto) {
    const tenantId = this.tenantOf(user);
    const where = this.buildWhere(tenantId, query, { userId: user.userId });

    const [rows, total] = await Promise.all([
      this.prisma.leaveRequest.findMany({
        where,
        include: REQUEST_INCLUDE,
        orderBy: { createdAt: 'desc' },
        skip: skipFor(query.page, query.limit),
        take: query.limit,
      }),
      this.prisma.leaveRequest.count({ where }),
    ]);

    return paginate(
      rows.map((row) => this.toResponse(row)),
      total,
      query.page,
      query.limit,
    );
  }

  /**
   * The caller's leave expanded to one entry per calendar day, newest first — what a
   * calendar view needs. A five-day request becomes five rows.
   */
  async findMinePerDay(user: AuthUser, query: QueryLeavePerDayDto) {
    const tenantId = this.tenantOf(user);
    const from = query.startDate ? leaveDate(query.startDate) : null;
    const to = query.endDate ? leaveDate(query.endDate) : null;

    const requests = await this.prisma.leaveRequest.findMany({
      where: {
        tenantId,
        userId: user.userId,
        ...(query.status ? { status: query.status } : {}),
        ...(to ? { startDate: { lte: to } } : {}),
        ...(from ? { endDate: { gte: from } } : {}),
      },
      include: REQUEST_INCLUDE,
    });

    const days: (ReturnType<typeof this.toResponse> & { date: Date })[] = [];
    for (const request of requests) {
      if (!request.startDate || !request.endDate) continue;
      const shaped = this.toResponse(request);
      for (
        let day = leaveDate(request.startDate);
        day <= leaveDate(request.endDate);
        day = nextDay(day)
      ) {
        if (from && day < from) continue;
        if (to && day > to) continue;
        days.push({ ...shaped, date: new Date(day) });
      }
    }

    days.sort((left, right) => right.date.getTime() - left.date.getTime());
    return days;
  }

  async findOne(user: AuthUser, id: string) {
    const request = await this.prisma.leaveRequest.findFirst({
      where: { id, tenantId: this.tenantOf(user) },
      include: REQUEST_INCLUDE,
    });
    if (!request) {
      throw new NotFoundException('Không tìm thấy yêu cầu nghỉ phép');
    }
    this.assertCanRead(user, request.user);
    return this.toResponse(request);
  }

  /**
   * The caller's annual allowance and what is left of it.
   *
   * Defaults to 12 days when the balance was never set — the statutory minimum, and what
   * the old service assumed in three separate places.
   */
  async balanceOf(user: AuthUser) {
    const tenantId = this.tenantOf(user);
    const staff = await this.prisma.user.findFirst({
      where: {
        id: user.userId,
        tenantId,
        status: { not: UserStatus.DELETED },
      },
      select: { leaveBalanceAnnualDays: true, leaveBalanceRemainingDays: true },
    });
    if (!staff) throw new NotFoundException('Không tìm thấy nhân viên');

    const annualLeaveDays =
      staff.leaveBalanceAnnualDays ?? DEFAULT_ANNUAL_LEAVE_DAYS;
    const remainingDays = staff.leaveBalanceRemainingDays ?? annualLeaveDays;
    return {
      annualLeaveDays,
      remainingDays,
      usedDays: annualLeaveDays - remainingDays,
    };
  }

  /**
   * Which shifts a leave window would leave without a supervisor.
   *
   * The old version returned "no handover needed" without querying for anyone who wasn't a
   * BRANCH_MANAGER/WAREHOUSE_MANAGER. Asking the database directly gives the same answer
   * for those people (they manage nothing, so nothing comes back) and a correct one for
   * anyone the role check would have missed.
   */
  async previewHandover(user: AuthUser, dto: PreviewHandoverDto) {
    const tenantId = this.tenantOf(user);
    const { from, toExclusive } = this.leaveWindow(dto.startDate, dto.endDate);

    const affected = await this.prisma.workingSchedule.findMany({
      where: this.managedInWindow(tenantId, user.userId, from, toExclusive),
      include: {
        shiftTemplate: true,
        assignedUsers: {
          select: {
            user: {
              select: {
                id: true,
                phoneNumber: true,
                profileFirstName: true,
                profileLastName: true,
              },
            },
          },
        },
      },
      orderBy: [{ workDate: 'asc' }, { startAt: 'asc' }],
    });

    return {
      requiresHandover: affected.length > 0,
      count: affected.length,
      affectedSchedules: affected,
    };
  }

  // ─── Filing ────────────────────────────────────────────────────────────────

  async create(user: AuthUser, dto: CreateLeaveRequestDto) {
    return this.file(user, user.userId, dto);
  }

  /**
   * A manager filing on somebody else's behalf — the employee is ill, or otherwise can't.
   *
   * The old controller gated this with `validateRoleHierarchy` plus a same-branch check.
   * The role half is gone; the location half stays, because "you may file for people you
   * work with" is the part that still means something.
   */
  async createEmergency(user: AuthUser, dto: CreateEmergencyLeaveRequestDto) {
    const tenantId = this.tenantOf(user);
    const target = await this.prisma.user.findFirst({
      where: { id: dto.userId, tenantId, status: { not: UserStatus.DELETED } },
      select: { id: true, branchId: true, warehouseId: true },
    });
    if (!target) throw new NotFoundException('Không tìm thấy nhân viên');

    if (
      user.systemRole !== SystemRole.TENANT_OWNER &&
      user.systemRole !== SystemRole.ADMIN &&
      !this.sameWorkplace(user, target)
    ) {
      throw new ForbiddenException(
        'Bạn chỉ có thể tạo yêu cầu nghỉ phép cho nhân viên cùng địa điểm làm việc',
      );
    }

    return this.file(user, dto.userId, dto);
  }

  /** The shared body of both filing routes. */
  private async file(
    actor: AuthUser,
    requesterId: string,
    dto: CreateLeaveRequestDto,
  ) {
    const tenantId = this.tenantOf(actor);
    const { from, to, toExclusive } = this.leaveWindow(
      dto.startDate,
      dto.endDate,
    );

    await this.assertNoOverlap(tenantId, requesterId, from, to);

    // Which of the requester's shifts the leave would strand. This is what decides whether
    // a handover is needed — not what role anyone holds.
    const affected = await this.prisma.workingSchedule.findMany({
      where: this.managedInWindow(tenantId, requesterId, from, toExclusive),
      select: { id: true },
    });

    if (affected.length === 0 && dto.handoverToUserId) {
      throw new BadRequestException(
        'Không có lịch làm việc nào cần bàn giao trong khoảng thời gian này',
      );
    }
    if (affected.length > 0) {
      await this.assertHandoverTargetValid(
        tenantId,
        requesterId,
        dto.handoverToUserId,
      );
    }

    const created = await this.prisma.leaveRequest.create({
      data: {
        tenantId,
        userId: requesterId,
        startDate: from,
        endDate: to,
        reason: dto.reason,
        status: LeaveRequestStatus.PENDING,
        handoverToUserId: affected.length > 0 ? dto.handoverToUserId : null,
        handoverSchedules: {
          create: affected.map((schedule) => ({ scheduleId: schedule.id })),
        },
      },
      include: REQUEST_INCLUDE,
    });

    // Outside the write: a failed notification must not lose the request. notify() never
    // throws, so there is nothing to catch.
    await this.notifyApprovers(tenantId, requesterId, (name) =>
      LeaveRequestNotificationTemplates.created(name, created.id),
    );

    return {
      message: 'Tạo yêu cầu nghỉ phép thành công',
      data: this.toResponse(created),
      handover: {
        required: affected.length > 0,
        reassignedSchedules: 0,
        handoverToUserId: created.handoverToUserId,
      },
    };
  }

  // ─── Review ────────────────────────────────────────────────────────────────

  /**
   * Approving or rejecting.
   *
   * On approval this is the only place the leave balance moves, and it moves inside the
   * same transaction as the status change and the handover — an approval that spent the
   * days but failed to reassign the shifts would leave the shop uncovered and the employee
   * short.
   */
  async review(
    user: AuthUser,
    id: string,
    decision: 'APPROVED' | 'REJECTED',
    dto: ReviewLeaveRequestDto,
  ) {
    const tenantId = this.tenantOf(user);

    if (decision === LeaveRequestStatus.REJECTED && !dto.reviewNote) {
      throw new BadRequestException(
        'Cần nhập ghi chú khi từ chối yêu cầu nghỉ phép',
      );
    }

    const updated = await this.prisma.$transaction(async (tx) => {
      const current = await tx.leaveRequest.findFirst({
        where: { id, tenantId },
        include: {
          user: { select: { id: true, branchId: true, warehouseId: true } },
          handoverSchedules: { select: { scheduleId: true } },
        },
      });
      if (!current) {
        throw new NotFoundException('Không tìm thấy yêu cầu nghỉ phép');
      }

      // Never your own, whatever your permissions — the whole point of an approval is that
      // somebody else looked at it.
      if (current.userId === user.userId) {
        throw new ForbiddenException(
          'Bạn không thể tự duyệt hoặc từ chối yêu cầu nghỉ phép của chính mình',
        );
      }
      this.assertCanRead(user, current.user);

      if (current.status !== LeaveRequestStatus.PENDING) {
        throw new ConflictException('Chỉ có thể duyệt yêu cầu đang chờ xử lý');
      }

      let paidLeaveDays = 0;
      let unpaidLeaveDays = 0;

      if (decision === LeaveRequestStatus.APPROVED) {
        if (
          dto.paidLeaveDays === undefined ||
          dto.unpaidLeaveDays === undefined
        ) {
          throw new BadRequestException(
            'Cần nhập số ngày nghỉ có lương và không lương khi duyệt',
          );
        }
        paidLeaveDays = dto.paidLeaveDays;
        unpaidLeaveDays = dto.unpaidLeaveDays;

        const total = paidLeaveDays + unpaidLeaveDays;
        if (total <= 0) {
          throw new BadRequestException(
            'Tổng số ngày nghỉ được duyệt phải lớn hơn 0',
          );
        }
        const requested = leaveDayCount(current.startDate!, current.endDate!);
        if (total > requested) {
          throw new BadRequestException(
            'Tổng số ngày nghỉ có lương và không lương không được vượt quá số ngày xin nghỉ',
          );
        }

        if (paidLeaveDays > 0) {
          await this.spendLeaveBalance(
            tx,
            tenantId,
            current.userId,
            paidLeaveDays,
          );
        }

        // Move the shifts. The handover target was validated when the request was filed;
        // re-checked here because the roster may have changed since.
        const scheduleIds = current.handoverSchedules.map((h) => h.scheduleId);
        if (scheduleIds.length > 0) {
          await this.assertHandoverTargetValid(
            tenantId,
            current.userId,
            current.handoverToUserId,
          );
          await tx.workingSchedule.updateMany({
            where: {
              id: { in: scheduleIds },
              tenantId,
              managedById: current.userId,
              status: ScheduleStatus.SCHEDULED,
            },
            data: { managedById: current.handoverToUserId },
          });
        }
      }

      return tx.leaveRequest.update({
        where: { id },
        data: {
          status: decision,
          approvedById: user.userId,
          reviewNote: dto.reviewNote,
          ...(decision === LeaveRequestStatus.APPROVED
            ? { paidLeaveDays, unpaidLeaveDays }
            : {}),
        },
        include: REQUEST_INCLUDE,
      });
    });

    await this.notifications.notify({
      tenantId,
      recipientIds: [updated.userId],
      referenceId: updated.id,
      ...(decision === LeaveRequestStatus.APPROVED
        ? LeaveRequestNotificationTemplates.approved(updated.id)
        : LeaveRequestNotificationTemplates.rejected(
            updated.id,
            updated.reviewNote,
          )),
    });

    return this.toResponse(updated);
  }

  /**
   * Withdrawing your own request.
   *
   * Refused once the leave has started: by then the roster has been built around it and
   * somebody has already covered the first day. Cancelling undoes both effects of the
   * approval — the balance goes back, and the shifts go **back to the person who filed
   * the leave**.
   */
  async cancel(user: AuthUser, id: string) {
    const tenantId = this.tenantOf(user);

    const cancelled = await this.prisma.$transaction(async (tx) => {
      const current = await tx.leaveRequest.findFirst({
        where: { id, tenantId },
        include: { handoverSchedules: { select: { scheduleId: true } } },
      });
      if (!current) {
        throw new NotFoundException('Không tìm thấy yêu cầu nghỉ phép');
      }
      if (current.userId !== user.userId) {
        throw new ForbiddenException(
          'Bạn chỉ có thể hủy yêu cầu nghỉ phép của chính mình',
        );
      }
      if (!LIVE_LEAVE_STATUSES.includes(current.status as never)) {
        throw new BadRequestException(
          'Chỉ có thể hủy yêu cầu đang chờ xử lý hoặc đã được duyệt',
        );
      }

      const today = leaveDate(new Date());
      if (current.startDate && leaveDate(current.startDate) <= today) {
        throw new BadRequestException(
          'Không thể hủy yêu cầu nghỉ phép khi ngày nghỉ đã bắt đầu',
        );
      }

      const paid = Number(current.paidLeaveDays);
      if (current.status === LeaveRequestStatus.APPROVED && paid > 0) {
        await tx.user.update({
          where: { id: current.userId },
          data: { leaveBalanceRemainingDays: { increment: paid } },
        });
      }

      const scheduleIds = current.handoverSchedules.map((h) => h.scheduleId);
      if (current.handoverToUserId && scheduleIds.length > 0) {
        // **Back to the person who went on leave**, not to nobody. iKiotMS-BE set
        // `managedBy: null` here, which is not the inverse of the approval — it left those
        // shifts with no supervisor at all, and (now that shift-supervisor rights are
        // ported) stripped the temporary permissions from both people.
        await tx.workingSchedule.updateMany({
          where: {
            id: { in: scheduleIds },
            tenantId,
            managedById: current.handoverToUserId,
            status: ScheduleStatus.SCHEDULED,
          },
          data: { managedById: current.userId },
        });
      }

      return tx.leaveRequest.update({
        where: { id },
        data: { status: LeaveRequestStatus.CANCELLED },
        include: REQUEST_INCLUDE,
      });
    });

    // The approvers need to know, especially for an approved request — the roster may have
    // been rearranged around it.
    await this.notifyApprovers(tenantId, cancelled.userId, (name) =>
      LeaveRequestNotificationTemplates.cancelled(name, cancelled.id),
    );

    return this.toResponse(cancelled);
  }

  // ─── Internals ─────────────────────────────────────────────────────────────

  private tenantOf(user: AuthUser): string {
    if (!user.tenantId) {
      throw new ForbiddenException('Tài khoản không thuộc cửa hàng nào');
    }
    return user.tenantId;
  }

  /** Validates and normalises a leave window to whole UTC days. */
  private leaveWindow(startDate: string, endDate: string) {
    const from = leaveDate(startDate);
    const to = leaveDate(endDate);
    if (from > to) {
      throw new BadRequestException(
        'Ngày kết thúc không được trước ngày bắt đầu',
      );
    }
    return { from, to, toExclusive: nextDay(to) };
  }

  /** Shifts this person supervises inside a window — the handover set. */
  private managedInWindow(
    tenantId: string,
    userId: string,
    from: Date,
    toExclusive: Date,
  ): Prisma.WorkingScheduleWhereInput {
    return {
      tenantId,
      managedById: userId,
      status: ScheduleStatus.SCHEDULED,
      workDate: { gte: from, lt: toExclusive },
    };
  }

  /** One person can't be on leave twice over the same days. */
  private async assertNoOverlap(
    tenantId: string,
    userId: string,
    from: Date,
    to: Date,
    exceptId?: string,
  ) {
    const overlap = await this.prisma.leaveRequest.findFirst({
      where: {
        tenantId,
        userId,
        status: { in: LIVE_LEAVE_STATUSES },
        startDate: { lte: to },
        endDate: { gte: from },
        ...(exceptId ? { id: { not: exceptId } } : {}),
      },
      select: { id: true, startDate: true, endDate: true, status: true },
    });
    if (overlap) {
      throw new ConflictException(
        'Tìm thấy yêu cầu nghỉ phép trùng lặp với khoảng thời gian đã chọn',
      );
    }
  }

  /**
   * The person taking over has to exist, be usable, not be the requester, and work in the
   * same place.
   */
  private async assertHandoverTargetValid(
    tenantId: string,
    requesterId: string,
    handoverToUserId: string | null | undefined,
  ) {
    if (!handoverToUserId) {
      throw new BadRequestException(
        'Cần chọn nhân viên nhận bàn giao vì có lịch làm việc trong thời gian nghỉ',
      );
    }
    if (handoverToUserId === requesterId) {
      throw new BadRequestException('Không thể bàn giao lịch cho chính mình');
    }

    const [requester, target] = await Promise.all([
      this.prisma.user.findFirst({
        where: { id: requesterId, tenantId },
        select: { branchId: true, warehouseId: true },
      }),
      this.prisma.user.findFirst({
        where: { id: handoverToUserId, tenantId },
        select: { id: true, status: true, branchId: true, warehouseId: true },
      }),
    ]);
    if (!target || INACTIVE_USER_STATUSES.has(target.status)) {
      throw new NotFoundException(
        'Không tìm thấy nhân viên nhận bàn giao hoặc tài khoản không hoạt động',
      );
    }
    if (
      requester &&
      (requester.branchId !== target.branchId ||
        requester.warehouseId !== target.warehouseId)
    ) {
      throw new BadRequestException(
        'Nhân viên nhận bàn giao phải làm việc cùng địa điểm',
      );
    }
  }

  /**
   * Takes paid days off the allowance.
   *
   * A conditional `updateMany` rather than read-then-write: two approvals landing at once
   * would both read the same remaining balance and both pass a plain comparison. Matching
   * nothing *is* the answer to "was there enough".
   */
  private async spendLeaveBalance(
    tx: Prisma.TransactionClient,
    tenantId: string,
    userId: string,
    days: number,
  ) {
    const staff = await tx.user.findFirst({
      where: { id: userId, tenantId, status: { not: UserStatus.DELETED } },
      select: { leaveBalanceAnnualDays: true, leaveBalanceRemainingDays: true },
    });
    if (!staff) throw new NotFoundException('Không tìm thấy nhân viên');

    // Fill in the default allowance the first time it is needed, as the old service did.
    if (
      staff.leaveBalanceAnnualDays === null ||
      staff.leaveBalanceRemainingDays === null
    ) {
      const annual = staff.leaveBalanceAnnualDays ?? DEFAULT_ANNUAL_LEAVE_DAYS;
      await tx.user.update({
        where: { id: userId },
        data: {
          leaveBalanceAnnualDays: annual,
          leaveBalanceRemainingDays: staff.leaveBalanceRemainingDays ?? annual,
        },
      });
    }

    const spent = await tx.user.updateMany({
      where: { id: userId, tenantId, leaveBalanceRemainingDays: { gte: days } },
      data: { leaveBalanceRemainingDays: { decrement: days } },
    });
    if (spent.count === 0) {
      throw new BadRequestException(
        'Số ngày nghỉ phép có lương còn lại không đủ',
      );
    }
  }

  /**
   * Tells whoever signs off on this person's leave.
   *
   * The copy is a callback rather than a value because it needs the requester's display
   * name, and looking that up is this method's job — the caller shouldn't have to.
   */
  private async notifyApprovers(
    tenantId: string,
    requesterId: string,
    content: (requesterName: string) => NotificationContent,
  ) {
    const requester = await this.prisma.user.findUnique({
      where: { id: requesterId },
      select: { branchId: true, warehouseId: true },
    });
    const [approvers, name] = await Promise.all([
      this.notifications.approversOf({
        userId: requesterId,
        tenantId,
        branchId: requester?.branchId ?? null,
        warehouseId: requester?.warehouseId ?? null,
      }),
      this.notifications.displayName(requesterId),
    ]);

    await this.notifications.notify({
      tenantId,
      recipientIds: approvers,
      ...content(name),
    });
  }

  // ─── Access ────────────────────────────────────────────────────────────────

  /** Your own always; `leaveRequests:read_all` widens it to your own location. */
  private readScope(user: AuthUser): Prisma.LeaveRequestWhereInput {
    if (
      user.systemRole === SystemRole.TENANT_OWNER ||
      user.systemRole === SystemRole.ADMIN
    ) {
      return {};
    }
    if (!can(user, 'leaveRequests', 'read_all')) {
      return { userId: user.userId };
    }
    if (user.branchId) return { user: { branchId: user.branchId } };
    if (user.warehouseId) return { user: { warehouseId: user.warehouseId } };
    return { userId: user.userId };
  }

  private assertCanRead(
    user: AuthUser,
    target: { id: string; branchId: string | null; warehouseId: string | null },
  ) {
    if (target.id === user.userId) return;
    if (
      user.systemRole === SystemRole.TENANT_OWNER ||
      user.systemRole === SystemRole.ADMIN
    ) {
      return;
    }
    if (this.sameWorkplace(user, target)) return;
    throw new ForbiddenException(
      'Bạn không có quyền xem yêu cầu nghỉ phép này',
    );
  }

  private sameWorkplace(
    user: AuthUser,
    target: { branchId: string | null; warehouseId: string | null },
  ): boolean {
    if (user.branchId) return target.branchId === user.branchId;
    if (user.warehouseId) return target.warehouseId === user.warehouseId;
    return false;
  }

  // ─── Filters ───────────────────────────────────────────────────────────────

  private buildWhere(
    tenantId: string,
    query: QueryLeaveRequestDto,
    scope: Prisma.LeaveRequestWhereInput,
  ): Prisma.LeaveRequestWhereInput {
    const where: Prisma.LeaveRequestWhereInput = { tenantId, ...scope };
    if (query.userId) where.userId = query.userId;
    if (query.status) where.status = query.status;

    if (query.branchId || query.warehouseId) {
      const scoped: Prisma.UserWhereInput =
        where.user && typeof where.user === 'object' ? where.user : {};
      where.user = {
        ...scoped,
        ...(query.branchId ? { branchId: query.branchId } : {}),
        ...(query.warehouseId ? { warehouseId: query.warehouseId } : {}),
      };
    }

    // Filters on when the leave *begins*, as the old filter did — "who is starting leave
    // this month" rather than "whose leave touches this month".
    if (query.startDate || query.endDate) {
      where.startDate = {
        ...(query.startDate ? { gte: leaveDate(query.startDate) } : {}),
        ...(query.endDate ? { lte: leaveDate(query.endDate) } : {}),
      };
    }

    if (query.keyword) {
      const match = { contains: query.keyword, mode: 'insensitive' } as const;
      where.OR = [
        { reason: match },
        { user: { profileFirstName: match } },
        { user: { profileLastName: match } },
      ];
    }

    return where;
  }

  private toResponse(row: RequestRow) {
    const { paidLeaveDays, unpaidLeaveDays, handoverSchedules, ...rest } = row;
    return {
      ...rest,
      paidLeaveDays: Number(paidLeaveDays),
      unpaidLeaveDays: Number(unpaidLeaveDays),
      handoverScheduleIds: handoverSchedules.map((h) => h.scheduleId),
    };
  }
}
