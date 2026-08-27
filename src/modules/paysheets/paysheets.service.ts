import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { paginate, skipFor } from '../../common/utils/pagination';
import { PaysheetDto, QueryPaysheetDto } from './dto/paysheet.dto';
import type { Prisma } from '../../../generated/prisma/client';

export const PaysheetStatus = { ACTIVE: 'ACTIVE', DELETED: 'DELETED' } as const;

const PAYSHEET_INCLUDE = {
  allowances: true,
  deductions: true,
  bonuses: { include: { tiers: { orderBy: { position: 'asc' } } } },
} as const satisfies Prisma.PaysheetInclude;

type PaysheetRow = Prisma.PaysheetGetPayload<{
  include: typeof PAYSHEET_INCLUDE;
}>;

/**
 * Pay schemes — the template an employee's salary is calculated from. Ported from
 * `PaySheetService`.
 *
 * One paysheet is shared by many employees (`User.paysheetId`), so **editing one changes
 * what everybody on it earns next period**. That is the intended behaviour — it is how a
 * shop gives twelve cashiers the same terms — and it is also why a paysheet is never hard
 * deleted: payslips already generated point at it, and a payslip has to stay explainable.
 *
 * **The old `buildPaySheetFilter` scoped the list to `createdBy` for branch and warehouse
 * managers.** Those roles are gone, so the list is the tenant's — a pay scheme is a
 * tenant-wide policy, and hiding a colleague's from someone who holds `paysheets:read`
 * would only make duplicates.
 */
@Injectable()
export class PaysheetService {
  constructor(private readonly prisma: PrismaService) {}

  async findAll(tenantId: string, query: QueryPaysheetDto) {
    const where: Prisma.PaysheetWhereInput = {
      tenantId,
      status: { not: PaysheetStatus.DELETED },
    };
    if (query.name) {
      where.name = { contains: query.name, mode: 'insensitive' };
    }

    const [rows, total] = await Promise.all([
      this.prisma.paysheet.findMany({
        where,
        include: PAYSHEET_INCLUDE,
        orderBy: { createdAt: 'desc' },
        skip: skipFor(query.page, query.limit),
        take: query.limit,
      }),
      this.prisma.paysheet.count({ where }),
    ]);

    return paginate(
      rows.map((row) => this.toResponse(row)),
      total,
      query.page,
      query.limit,
    );
  }

  async findOne(tenantId: string, id: string) {
    return this.toResponse(await this.findRow(tenantId, id));
  }

  async create(tenantId: string, actorId: string, dto: PaysheetDto) {
    this.assertPayTypeIsUsable(dto);
    const created = await this.prisma.paysheet.create({
      data: {
        tenantId,
        createdById: actorId,
        status: PaysheetStatus.ACTIVE,
        ...this.scalarFields(dto),
        ...this.nestedCreates(dto),
      },
      include: PAYSHEET_INCLUDE,
    });
    return {
      message: 'Tạo bảng lương thành công',
      data: this.toResponse(created),
    };
  }

  /**
   * A full replace, as the old service was: the nested collections are deleted and
   * rewritten, so the client sends the lists it wants to end up with.
   */
  async update(tenantId: string, id: string, dto: PaysheetDto) {
    this.assertPayTypeIsUsable(dto);
    await this.findRow(tenantId, id);

    const updated = await this.prisma.$transaction(async (tx) => {
      await tx.paysheetAllowance.deleteMany({ where: { paysheetId: id } });
      await tx.paysheetDeduction.deleteMany({ where: { paysheetId: id } });
      // Tiers cascade from the bonus row.
      await tx.paysheetBonus.deleteMany({ where: { paysheetId: id } });

      return tx.paysheet.update({
        where: { id },
        data: { ...this.scalarFields(dto), ...this.nestedCreates(dto) },
        include: PAYSHEET_INCLUDE,
      });
    });

    return {
      message: 'Cập nhật bảng lương thành công',
      data: this.toResponse(updated),
    };
  }

  /**
   * The rates an employee's paysheet implies, in the shape `payroll-math.ts` wants.
   *
   * The single place Prisma `Decimal`s become numbers for the calculation, and the single
   * place the schema's flat `basicPay*` columns are read — the engine never sees a row.
   */
  static ratesOf(row: {
    basicPayType: string | null;
    basicPayAmountPerShift: Prisma.Decimal | null;
    basicPaySalaryPerPeriod: Prisma.Decimal | null;
    basicPayStandardWorkingDaySalary: Prisma.Decimal | null;
    basicPayRateWeekend: Prisma.Decimal;
    basicPayRatePublicHoliday: Prisma.Decimal;
    overtimeNormalDay: Prisma.Decimal;
    overtimeWeekend: Prisma.Decimal;
    overtimePublicHoliday: Prisma.Decimal;
  }) {
    return {
      payType: row.basicPayType,
      amountPerShift: Number(row.basicPayAmountPerShift ?? 0),
      salaryPerPeriod: Number(row.basicPaySalaryPerPeriod ?? 0),
      standardWorkingDaySalary: Number(
        row.basicPayStandardWorkingDaySalary ?? 0,
      ),
      baseWeekend: Number(row.basicPayRateWeekend),
      basePublicHoliday: Number(row.basicPayRatePublicHoliday),
      overtimeNormalDay: Number(row.overtimeNormalDay),
      overtimeWeekend: Number(row.overtimeWeekend),
      overtimePublicHoliday: Number(row.overtimePublicHoliday),
    };
  }

  private async findRow(tenantId: string, id: string): Promise<PaysheetRow> {
    const row = await this.prisma.paysheet.findFirst({
      where: { id, tenantId, status: { not: PaysheetStatus.DELETED } },
      include: PAYSHEET_INCLUDE,
    });
    if (!row) throw new NotFoundException('Không tìm thấy bảng lương');
    return row;
  }

  /**
   * The amount a pay type depends on has to actually be there.
   *
   * The old service accepted a FIXED paysheet with no `salaryPerPeriod` and only refused
   * it much later, at generation time, as a per-employee "skipped" reason. Catching it here
   * as well means the shop finds out when they configure it rather than at month end —
   * the later check stays, because a paysheet can be edited after employees are on it.
   */
  private assertPayTypeIsUsable(dto: PaysheetDto): void {
    const {
      payType,
      amountPerShift,
      salaryPerPeriod,
      standardWorkingDaySalary,
    } = dto.basicPay;

    const required: Record<string, number | undefined> = {
      PAY_BY_SHIFT: amountPerShift,
      FIXED: salaryPerPeriod,
      STANDARD_WORKING_DAY: standardWorkingDaySalary,
    };
    if (!(required[payType] && required[payType] > 0)) {
      throw new BadRequestException(
        `Cấu hình lương ${payType} cần một mức lương lớn hơn 0`,
      );
    }
  }

  private scalarFields(dto: PaysheetDto) {
    return {
      name: dto.name,
      basicPayType: dto.basicPay.payType,
      basicPayAmountPerShift: dto.basicPay.amountPerShift,
      basicPaySalaryPerPeriod: dto.basicPay.salaryPerPeriod,
      basicPayStandardWorkingDaySalary: dto.basicPay.standardWorkingDaySalary,
      basicPayRateWeekend: dto.basicPay.rateWeekend,
      basicPayRatePublicHoliday: dto.basicPay.ratePublicHoliday,
      overtimeNormalDay: dto.overtime?.normalDay,
      overtimeWeekend: dto.overtime?.weekend,
      overtimePublicHoliday: dto.overtime?.publicHoliday,
    };
  }

  private nestedCreates(dto: PaysheetDto) {
    return {
      allowances: {
        create: (dto.allowances ?? []).map((item) => ({
          name: item.name,
          enable: item.enable ?? false,
          amountType: item.amountType,
          amountValue: item.amountValue,
        })),
      },
      deductions: {
        create: (dto.deductions ?? []).map((item) => ({
          name: item.name,
          enable: item.enable ?? false,
          deductionType: item.deductionType,
          conditionType: item.conditionType,
          // Only meaningful for BY_BLOCK; stored null otherwise so a stale value can't
          // silently change how a rule is priced later.
          blockMinutes:
            item.conditionType === 'BY_BLOCK' ? item.blockMinutes : null,
          deductionValue: item.deductionValue,
        })),
      },
      bonuses: {
        create: (dto.bonuses ?? []).map((bonus) => ({
          bonusType: bonus.bonusType,
          calculationType: bonus.calculationType,
          enable: bonus.enable ?? false,
          tiers: {
            create: (bonus.tiers ?? []).map((tier, position) => ({
              name: tier.name,
              fromValue: tier.fromValue,
              rewardType: tier.rewardType,
              rewardValue: tier.rewardValue,
              position,
            })),
          },
        })),
      },
    };
  }

  /** Decimals become numbers and the flat columns go back out nested, as the old API had. */
  private toResponse(row: PaysheetRow) {
    const {
      basicPayType,
      basicPayAmountPerShift,
      basicPaySalaryPerPeriod,
      basicPayStandardWorkingDaySalary,
      basicPayRateWeekend,
      basicPayRatePublicHoliday,
      overtimeNormalDay,
      overtimeWeekend,
      overtimePublicHoliday,
      allowances,
      deductions,
      bonuses,
      ...rest
    } = row;

    return {
      ...rest,
      basicPay: {
        payType: basicPayType,
        amountPerShift: Number(basicPayAmountPerShift ?? 0),
        salaryPerPeriod: Number(basicPaySalaryPerPeriod ?? 0),
        standardWorkingDaySalary: Number(basicPayStandardWorkingDaySalary ?? 0),
        rateWeekend: Number(basicPayRateWeekend),
        ratePublicHoliday: Number(basicPayRatePublicHoliday),
      },
      overtime: {
        normalDay: Number(overtimeNormalDay),
        weekend: Number(overtimeWeekend),
        publicHoliday: Number(overtimePublicHoliday),
      },
      allowances: allowances.map((item) => ({
        ...item,
        amountValue: Number(item.amountValue ?? 0),
      })),
      deductions: deductions.map((item) => ({
        ...item,
        deductionValue: Number(item.deductionValue),
      })),
      bonuses: bonuses.map((bonus) => ({
        ...bonus,
        tiers: bonus.tiers.map((tier) => ({
          ...tier,
          fromValue: tier.fromValue === null ? null : Number(tier.fromValue),
          rewardValue:
            tier.rewardValue === null ? null : Number(tier.rewardValue),
        })),
      })),
    };
  }
}
