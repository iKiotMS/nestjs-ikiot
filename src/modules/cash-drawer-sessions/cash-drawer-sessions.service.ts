import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { LocationStatus } from '../../common/constants/location-status';
import { UserStatus } from '../../common/constants/user-status';
import { SystemRole } from '../../common/constants/system-role';
import { can } from '../../common/utils/permission';
import { paginate, skipFor } from '../../common/utils/pagination';
import type { AuthUser } from '../../common/types/auth-user.type';
import { supervisesLocation } from '../working-schedules/shift-supervisor.service';
import { businessDate } from './business-date';
import { CashDrawerStatus, ShiftLogType } from './cash-drawer.constants';
import {
  FinalizeCashDrawerDto,
  OpenCashDrawerDto,
  QueryCashDrawerDto,
  SubmitShiftLogDto,
} from './dto/cash-drawer.dto';
import type { Prisma } from '../../../generated/prisma/client';

const STAFF_SELECT = {
  id: true,
  phoneNumber: true,
  profileFirstName: true,
  profileLastName: true,
} as const;

const SESSION_INCLUDE = {
  branch: { select: { id: true, name: true } },
  openedBy: { select: STAFF_SELECT },
  currentStaff: { select: STAFF_SELECT },
  finalLogManager: { select: STAFF_SELECT },
  shiftLogs: {
    // `id` is only a tie-break, not a claim about insertion order — two logs a microsecond
    // apart would otherwise come back in an arbitrary order on each read, and
    // `shiftLogs.at(-1)` is what the whole START/END/finalize state machine reads. Stable
    // beats correct-looking here; what actually keeps duplicates out is the guard in
    // submitShiftLog.
    orderBy: [{ loggedAt: 'asc' }, { id: 'asc' }],
    include: {
      staff: { select: STAFF_SELECT },
      nextStaff: { select: STAFF_SELECT },
    },
  },
} as const satisfies Prisma.CashDrawerSessionInclude;

type SessionRow = Prisma.CashDrawerSessionGetPayload<{
  include: typeof SESSION_INCLUDE;
}>;

/**
 * Real port of iKiotMS-BE's CashDrawerService.
 *
 * A session is one branch's till for one trading day. It opens with a counted float, passes
 * from cashier to cashier through shift logs, and closes once with a counted total. The
 * whole point is that every transfer of custody is written down, so a shortfall at the end
 * of the day can be narrowed to a shift.
 *
 * **Two invariants, both enforced by the database rather than by a read-then-write.**
 * `@@unique([tenantId, branchId, businessDate])` gives one session per branch per day, and
 * a partial unique index gives at most one OPEN session per branch. The partial one had to
 * be added by hand — see `20260826060000_cash_drawer_single_open_session`; the plain
 * `@@unique` the schema shipped with capped a branch at one *closed* session for all time,
 * which would have failed on the second day of use.
 *
 * **Access is a substitution.** The old service branched on BRANCH_MANAGER/STAFF; that role
 * is gone, so the branch comes from where the account
 * is posted (an owner, posted nowhere, names one), and `cash_drawers:read` vs `read_own`
 * decides whether they see the whole branch's sessions or only the ones they worked. Both
 * pairs were already in the catalog, unused — this is what they were for.
 */
@Injectable()
export class CashDrawerSessionService {
  constructor(private readonly prisma: PrismaService) {}

  // ─── Open ──────────────────────────────────────────────────────────────────

  async open(user: AuthUser, dto: OpenCashDrawerDto) {
    const tenantId = this.tenantOf(user);
    // required = true, so this is never null here.
    const branchId = this.resolveBranch(user, dto.branchId)!;
    await this.assertBranchAndStaff(tenantId, branchId, dto.staffId);

    try {
      const created = await this.prisma.cashDrawerSession.create({
        data: {
          tenantId,
          branchId,
          businessDate: businessDate(),
          openingAmount: dto.openingAmount,
          openedById: user.userId,
          currentStaffId: dto.staffId,
          status: CashDrawerStatus.OPEN,
        },
        include: SESSION_INCLUDE,
      });
      return this.toResponse(created);
    } catch (error) {
      // Either invariant can be the one that fired: a drawer is already open at this
      // branch, or today's session was already opened and closed. Both mean the same thing
      // to the person at the till.
      if (this.isUniqueViolation(error)) {
        throw new ConflictException(
          'Chi nhánh này đã có ca quầy cho hôm nay hoặc đang có ca chưa đóng',
        );
      }
      throw error;
    }
  }

  // ─── Reads ─────────────────────────────────────────────────────────────────

  /** The drawer currently open at a branch — what a till asks for on startup. */
  async current(user: AuthUser, requestedBranchId?: string) {
    const tenantId = this.tenantOf(user);
    const branchId = this.resolveBranch(user, requestedBranchId)!;

    const session = await this.prisma.cashDrawerSession.findFirst({
      where: {
        tenantId,
        branchId,
        status: CashDrawerStatus.OPEN,
        ...this.ownershipFilter(user),
      },
      include: SESSION_INCLUDE,
    });
    if (!session) {
      throw new NotFoundException('Không có ca quầy nào đang mở');
    }
    return this.toResponse(session);
  }

  async findAll(user: AuthUser, query: QueryCashDrawerDto) {
    const tenantId = this.tenantOf(user);
    const branchId = this.resolveBranch(user, query.branchId, false);

    const where: Prisma.CashDrawerSessionWhereInput = {
      tenantId,
      ...(branchId ? { branchId } : {}),
      ...this.ownershipFilter(user),
    };
    if (query.status) where.status = query.status;
    if (query.fromDate || query.toDate) {
      where.businessDate = {
        ...(query.fromDate ? { gte: new Date(query.fromDate) } : {}),
        ...(query.toDate ? { lte: new Date(query.toDate) } : {}),
      };
    }

    const [rows, total] = await Promise.all([
      this.prisma.cashDrawerSession.findMany({
        where,
        include: SESSION_INCLUDE,
        orderBy: [{ businessDate: 'desc' }, { createdAt: 'desc' }],
        skip: skipFor(query.page, query.limit),
        take: query.limit,
      }),
      this.prisma.cashDrawerSession.count({ where }),
    ]);

    // The old list dropped shiftLogs to keep the payload small; the summary below keeps
    // the useful part of them (how many shifts, who has it now) without the full history.
    return paginate(
      rows.map((row) => this.toSummary(row)),
      total,
      query.page,
      query.limit,
    );
  }

  async findOne(user: AuthUser, id: string) {
    return this.toResponse(await this.findRow(user, id));
  }

  // ─── Shift logs ────────────────────────────────────────────────────────────

  /**
   * Records a cashier taking the drawer or handing it back.
   *
   * The sequence is the point, so it is checked rather than assumed: a `START` is only
   * valid as the first log of the session or straight after an `END` that named this person
   * as the next one, and an `END` is only valid from whoever filed the matching `START`.
   * Without that, two cashiers can both claim to have held the drawer for the same stretch
   * and a shortfall becomes unattributable.
   *
   * Only the person currently holding the drawer may write to it.
   */
  async submitShiftLog(user: AuthUser, id: string, dto: SubmitShiftLogDto) {
    const tenantId = this.tenantOf(user);
    const session = await this.findRow(user, id);

    if (session.status !== CashDrawerStatus.OPEN) {
      throw new ConflictException('Ca quầy đã đóng');
    }
    if (session.currentStaffId !== user.userId) {
      throw new ForbiddenException(
        'Chỉ nhân viên đang giữ quầy mới ghi được phiếu ca',
      );
    }
    if (dto.type === ShiftLogType.START && dto.nextStaffId) {
      throw new BadRequestException(
        'nextStaffId chỉ dùng được với phiếu kết ca (END)',
      );
    }

    const lastLog = session.shiftLogs.at(-1);
    if (dto.type === ShiftLogType.START) {
      const isFirstShift = !lastLog;
      const handedToMe =
        lastLog?.type === ShiftLogType.END &&
        lastLog.nextStaffId === user.userId;
      if (!isFirstShift && !handedToMe) {
        throw new ConflictException(
          'Ca hiện tại đã bắt đầu, hoặc bạn không được bàn giao ca này',
        );
      }
    } else {
      const startedByMe =
        lastLog?.type === ShiftLogType.START && lastLog.staffId === user.userId;
      if (!startedByMe) {
        throw new ConflictException('Cần ghi phiếu bắt đầu ca (START) trước');
      }
    }

    if (dto.nextStaffId) {
      if (dto.nextStaffId === user.userId) {
        throw new BadRequestException('Người nhận ca phải là người khác');
      }
      await this.assertBranchAndStaff(
        tenantId,
        session.branchId,
        dto.nextStaffId,
      );
    }

    // Who holds the drawer once this log is written: unchanged unless this is a handover.
    // Written unconditionally, and that is load-bearing — see below.
    const nextHolder = dto.nextStaffId ?? user.userId;

    await this.prisma.$transaction(async (tx) => {
      // Guarded on the state we read: another till writing a log in between would make the
      // sequence check above stale, and a duplicate shift log makes a shortfall
      // unattributable — which is the one thing this module exists to prevent.
      //
      // `data` must never be empty. `updateMany({ data: {} })` matches the row but does
      // **not** touch `@updatedAt` (measured, not assumed), so the guard would never
      // advance and two identical requests — a double tap, a client retry — would both
      // pass and both insert. iKiotMS-BE got this for free: shift logs were an embedded
      // array, so `$push` always moved `updatedAt`. They are their own table here, so the
      // write has to be explicit.
      const claimed = await tx.cashDrawerSession.updateMany({
        where: {
          id,
          tenantId,
          status: CashDrawerStatus.OPEN,
          currentStaffId: user.userId,
          updatedAt: session.updatedAt,
        },
        data: { currentStaffId: nextHolder },
      });
      if (claimed.count === 0) {
        throw new ConflictException(
          'Ca quầy vừa thay đổi, vui lòng tải lại và thử lại',
        );
      }

      await tx.cashDrawerShiftLog.create({
        data: {
          sessionId: id,
          type: dto.type,
          staffId: user.userId,
          amount: dto.amount,
          nextStaffId: dto.nextStaffId,
          note: dto.note,
        },
      });
    });

    return this.toResponse(await this.findRow(user, id));
  }

  /**
   * Closes the day with a counted total.
   *
   * Refused unless the last log is an `END` from whoever holds the drawer and names nobody
   * to take over — that log is the handover to the manager, and closing without it would
   * leave the final stretch of the day unaccounted for.
   */
  async finalize(user: AuthUser, id: string, dto: FinalizeCashDrawerDto) {
    const tenantId = this.tenantOf(user);
    const session = await this.findRow(user, id);

    if (session.status !== CashDrawerStatus.OPEN) {
      throw new ConflictException('Ca quầy đã đóng');
    }

    const lastLog = session.shiftLogs.at(-1);
    const closedOut =
      lastLog?.type === ShiftLogType.END &&
      lastLog.staffId === session.currentStaffId &&
      lastLog.nextStaffId === null;
    if (!closedOut) {
      throw new ConflictException(
        'Nhân viên đang giữ quầy phải ghi phiếu kết ca cuối cùng trước khi chốt',
      );
    }

    const claimed = await this.prisma.cashDrawerSession.updateMany({
      where: {
        id,
        tenantId,
        status: CashDrawerStatus.OPEN,
        updatedAt: session.updatedAt,
      },
      data: {
        status: CashDrawerStatus.CLOSED,
        finalLogAmount: dto.finalAmount,
        finalLogManagerId: user.userId,
        finalLogNote: dto.note,
      },
    });
    if (claimed.count === 0) {
      throw new ConflictException(
        'Ca quầy vừa thay đổi, vui lòng tải lại và thử lại',
      );
    }

    return this.toResponse(await this.findRow(user, id));
  }

  // ─── Access ────────────────────────────────────────────────────────────────

  private tenantOf(user: AuthUser): string {
    if (!user.tenantId) {
      throw new ForbiddenException('Tài khoản không thuộc cửa hàng nào');
    }
    return user.tenantId;
  }

  /**
   * Which branch's drawer this call is about, or `null` for "every branch in the tenant".
   *
   * Three cases, and the third is the one that matters:
   *  - posted at a branch → theirs, and naming another is a 403, not a silent redirect;
   *  - an owner or admin, posted nowhere by design → whichever branch they name, or all of
   *    them when the caller doesn't need one;
   *  - **anyone else with no posting → refused.** A staff account that has been granted
   *    `cash_drawers:read` but never assigned to a branch would otherwise fall through to
   *    "no branch filter" and see every till in the tenant. iKiotMS-BE threw 403 here
   *    ("User has no branch assigned") and so does this.
   *
   * Returns `null`, never `''` — an empty string is still a `string` and one day ends up
   * in a `where` as if it were a real branch id.
   */
  private resolveBranch(
    user: AuthUser,
    requested: string | undefined,
    required = true,
  ): string | null {
    if (user.branchId) {
      // A shift supervisor reaches the branch their live shift covers — which
      // `ShiftSupervisorService` has already intersected with their own posting, so in
      // practice this is the same branch. It is checked anyway so the rule reads the same
      // here as it does in stock movements. (iKiotMS-BE's `managedScheduleAccess`.)
      const allowed =
        requested === user.branchId ||
        supervisesLocation(user.shiftSupervision, {
          branchId: requested ?? null,
          warehouseId: null,
        });
      if (requested && !allowed) {
        throw new ForbiddenException(
          'Bạn không thao tác được với quầy của chi nhánh khác',
        );
      }
      return user.branchId;
    }

    if (
      user.systemRole !== SystemRole.TENANT_OWNER &&
      user.systemRole !== SystemRole.ADMIN
    ) {
      throw new ForbiddenException(
        'Tài khoản chưa được phân về chi nhánh nào để xem quầy',
      );
    }

    if (requested) return requested;
    if (required) {
      throw new BadRequestException('Cần chỉ rõ branchId');
    }
    return null;
  }

  /**
   * Whether this account sees every session at the branch or only the ones it worked.
   *
   * `cash_drawers:read` is the whole branch; `read_own` on its own is the sessions where
   * they hold the drawer or filed a shift log. Both pairs have been in the catalog since
   * the RBAC redesign with nothing using them.
   */
  private ownershipFilter(user: AuthUser): Prisma.CashDrawerSessionWhereInput {
    if (can(user, 'cash_drawers', 'read')) return {};
    return {
      OR: [
        { currentStaffId: user.userId },
        { shiftLogs: { some: { staffId: user.userId } } },
      ],
    };
  }

  private async findRow(user: AuthUser, id: string): Promise<SessionRow> {
    const branchId = this.resolveBranch(user, undefined, false);
    const session = await this.prisma.cashDrawerSession.findFirst({
      where: {
        id,
        tenantId: this.tenantOf(user),
        ...(branchId ? { branchId } : {}),
        ...this.ownershipFilter(user),
      },
      include: SESSION_INCLUDE,
    });
    if (!session) throw new NotFoundException('Không tìm thấy ca quầy');
    return session;
  }

  // ─── Guards ────────────────────────────────────────────────────────────────

  /**
   * The branch has to be live and the cashier has to actually work there.
   *
   * The old check also required a STAFF-family role; that enum is gone, so what remains is
   * the part that still means something: an active account posted at this branch.
   */
  private async assertBranchAndStaff(
    tenantId: string,
    branchId: string,
    staffId: string,
  ) {
    const [branch, staff] = await Promise.all([
      this.prisma.branch.findFirst({
        where: { id: branchId, tenantId, status: LocationStatus.ACTIVE },
        select: { id: true },
      }),
      this.prisma.user.findFirst({
        where: {
          id: staffId,
          tenantId,
          branchId,
          status: UserStatus.ACTIVE,
          systemRole: SystemRole.STAFF,
        },
        select: { id: true },
      }),
    ]);

    if (!branch) {
      throw new NotFoundException('Không tìm thấy chi nhánh đang hoạt động');
    }
    if (!staff) {
      throw new NotFoundException(
        'Không tìm thấy nhân viên đang hoạt động tại chi nhánh này',
      );
    }
  }

  private isUniqueViolation(error: unknown): boolean {
    return (
      typeof error === 'object' &&
      error !== null &&
      'code' in error &&
      (error as { code?: unknown }).code === 'P2002'
    );
  }

  // ─── Shapes ────────────────────────────────────────────────────────────────

  private toResponse(session: SessionRow) {
    const {
      openingAmount,
      finalLogAmount,
      finalLogManagerId,
      finalLogNote,
      finalLogManager,
      shiftLogs,
      ...rest
    } = session;

    return {
      ...rest,
      openingAmount: Number(openingAmount),
      // Re-nested: the columns are flat but the API kept iKiotMS-BE's `finalLog` object.
      finalLog:
        finalLogAmount === null
          ? null
          : {
              amount: Number(finalLogAmount),
              managerId: finalLogManagerId,
              manager: finalLogManager,
              note: finalLogNote,
            },
      shiftLogs: shiftLogs.map((log) => ({
        ...log,
        amount: Number(log.amount),
      })),
    };
  }

  /** List rows: everything except the shift-log history, which is what detail is for. */
  private toSummary(session: SessionRow) {
    const { shiftLogs, ...rest } = this.toResponse(session);
    return { ...rest, shiftLogCount: shiftLogs.length };
  }
}
