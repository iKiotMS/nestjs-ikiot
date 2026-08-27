import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import {
  CreatePayrollSettingDto,
  UpdatePayrollSettingDto,
} from './dto/payroll-setting.dto';
import type { PayrollSetting } from '../../../generated/prisma/client';

/**
 * One row per tenant — the numbers every payroll calculation divides by.
 *
 * Ported from `PayrollSettingService`. **Exactly one setting per tenant**, which the old
 * service enforced by refusing a second create; here `@@unique` would be better but the
 * schema doesn't carry one, so the check stays where it was.
 *
 * `lateGraceMinutes` is read from here by three modules — attendance (when it stores
 * `lateMinutes`), the schedule view, and payroll — which is exactly why it is one tenant
 * setting rather than three constants.
 */
@Injectable()
export class PayrollSettingService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * The tenant's settings, or a 404.
   *
   * Payroll needs these to compute anything, so "not configured" has to be an explicit
   * failure rather than a silent set of defaults — a shop that never set
   * `standardWorkingDays` would otherwise have salaries divided by a number nobody chose.
   */
  async findOne(tenantId: string): Promise<PayrollSetting> {
    const setting = await this.prisma.payrollSetting.findFirst({
      where: { tenantId },
    });
    if (!setting) throw new NotFoundException('Không tìm thấy cấu hình lương');
    return setting;
  }

  async create(tenantId: string, dto: CreatePayrollSettingDto) {
    const existing = await this.prisma.payrollSetting.findFirst({
      where: { tenantId },
      select: { id: true },
    });
    if (existing) throw new ConflictException('Cấu hình lương đã tồn tại');

    const data = await this.prisma.payrollSetting.create({
      data: { tenantId, ...dto },
    });
    return { message: 'Cấu hình lương đã được tạo thành công', data };
  }

  async update(tenantId: string, dto: UpdatePayrollSettingDto) {
    if (Object.keys(dto).length === 0) {
      throw new BadRequestException('Không có dữ liệu cập nhật');
    }
    const current = await this.findOne(tenantId);
    const data = await this.prisma.payrollSetting.update({
      where: { id: current.id },
      data: dto,
    });
    return { message: 'Cấu hình lương đã được cập nhật thành công', data };
  }
}
