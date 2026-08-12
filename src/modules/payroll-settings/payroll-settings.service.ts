import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { CreatePayrollSettingDto } from './dto/create-payroll-settings.dto';
import { UpdatePayrollSettingDto } from './dto/update-payroll-settings.dto';

@Injectable()
export class PayrollSettingService {
  constructor(private readonly prisma: PrismaService) {}

  findAll(tenantId?: string) {
    return this.prisma.payrollSetting.findMany(tenantId ? { where: { tenantId } } : undefined);
  }

  findOne(id: string) {
    return this.prisma.payrollSetting.findUniqueOrThrow({ where: { id } });
  }

  create(data: CreatePayrollSettingDto) {
    return this.prisma.payrollSetting.create({ data: data as any });
  }

  update(id: string, data: UpdatePayrollSettingDto) {
    return this.prisma.payrollSetting.update({ where: { id }, data: data as any });
  }

  remove(id: string) {
    return this.prisma.payrollSetting.delete({ where: { id } });
  }
}
