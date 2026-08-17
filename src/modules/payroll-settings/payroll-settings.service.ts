import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { CreatePayrollSettingDto } from './dto/create-payroll-settings.dto';
import { UpdatePayrollSettingDto } from './dto/update-payroll-settings.dto';

@Injectable()
export class PayrollSettingService {
  constructor(private readonly prisma: PrismaService) {}

  findAll(tenantId?: string) {
    return this.prisma.payrollSetting.findMany({
      where: { ...(tenantId ? { tenantId } : {}) },
    });
  }

  // findFirst + explicit throw rather than findFirstOrThrow: Prisma's own not-found error
  // isn't an HttpException, so Nest turns it into a 500. A row in another tenant must be
  // indistinguishable from one that doesn't exist — 404 either way, never 403.
  async findOne(tenantId: string | undefined, id: string) {
    const found = await this.prisma.payrollSetting.findFirst({
      where: { id, ...(tenantId ? { tenantId } : {}) },
    });
    if (!found) throw new NotFoundException('PayrollSetting not found');
    return found;
  }

  create(tenantId: string, data: CreatePayrollSettingDto) {
    return this.prisma.payrollSetting.create({ data: { ...data, tenantId } });
  }

  async update(
    tenantId: string | undefined,
    id: string,
    data: UpdatePayrollSettingDto,
  ) {
    await this.findOne(tenantId, id);
    return this.prisma.payrollSetting.update({ where: { id }, data });
  }

  async remove(tenantId: string | undefined, id: string) {
    await this.findOne(tenantId, id);
    return this.prisma.payrollSetting.delete({ where: { id } });
  }
}
