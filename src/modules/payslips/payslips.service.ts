import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { paginate, skipFor } from '../../common/utils/pagination';
import { PaginationQueryDto } from '../../common/dto/pagination-query.dto';
import { EMPLOYEE_VISIBLE_PAYSLIP_STATUSES } from '../payroll-periods/payroll-period.constants';
import type { Prisma } from '../../../generated/prisma/client';

const PERIOD_SELECT = {
  select: {
    id: true,
    name: true,
    periodStart: true,
    periodEnd: true,
    status: true,
    paidAt: true,
  },
} as const;

/**
 * An employee reading their own payslips — iKiotMS-BE's `/payroll/my-payslips`.
 *
 * **Own only, and only once the period reaches REVIEW.** A DRAFT payslip is the manager's
 * working copy and showing it would have people querying numbers still being edited;
 * CANCELLED ones describe a period that never happened. REVIEW is visible on purpose —
 * that window exists so employees can check their provisional figures and object before
 * APPROVED fixes them.
 */
@Injectable()
export class PayslipService {
  constructor(private readonly prisma: PrismaService) {}

  private visibleTo(
    tenantId: string,
    userId: string,
  ): Prisma.PayslipWhereInput {
    return {
      tenantId,
      userId,
      status: { in: EMPLOYEE_VISIBLE_PAYSLIP_STATUSES },
    };
  }

  async findMine(tenantId: string, userId: string, query: PaginationQueryDto) {
    const where = this.visibleTo(tenantId, userId);
    const [rows, total] = await Promise.all([
      this.prisma.payslip.findMany({
        where,
        include: { payrollPeriod: PERIOD_SELECT },
        orderBy: { periodEnd: 'desc' },
        skip: skipFor(query.page, query.limit),
        take: query.limit,
      }),
      this.prisma.payslip.count({ where }),
    ]);

    return paginate(
      rows.map((row) => this.toResponse(row)),
      total,
      query.page,
      query.limit,
    );
  }

  async findMineOne(tenantId: string, userId: string, id: string) {
    const payslip = await this.prisma.payslip.findFirst({
      where: { ...this.visibleTo(tenantId, userId), id },
      include: {
        payrollPeriod: PERIOD_SELECT,
        allowanceLines: true,
        deductionLines: true,
        leaveLines: { include: { dates: true } },
        manualAdjustments: true,
      },
    });
    if (!payslip) {
      throw new NotFoundException('Không tìm thấy phiếu lương có thể xem');
    }
    return this.toResponse(payslip);
  }

  /** Decimals become numbers — every one of these is displayed as money. */
  private toResponse<T extends Record<string, unknown>>(payslip: T): T {
    const money = [
      'totalWorkedDays',
      'totalWorkedHours',
      'basePay',
      'overtimePay',
      'paidLeaveDays',
      'unpaidLeaveDays',
      'paidLeavePay',
      'unpaidLeaveDeduction',
      'bonus',
      'allowance',
      'grossSalary',
      'deduction',
      'netSalary',
    ];
    const shaped: Record<string, unknown> = { ...payslip };
    for (const key of money) {
      if (shaped[key] !== null && shaped[key] !== undefined) {
        shaped[key] = Number(shaped[key]);
      }
    }
    return shaped as T;
  }
}
