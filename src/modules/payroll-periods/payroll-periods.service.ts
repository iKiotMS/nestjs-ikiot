import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { CreatePayrollPeriodDto } from './dto/create-payroll-periods.dto';
import { UpdatePayrollPeriodDto } from './dto/update-payroll-periods.dto';

@Injectable()
export class PayrollPeriodService {
  constructor(private readonly prisma: PrismaService) {}

  findAll(tenantId?: string) {
    return this.prisma.payrollPeriod.findMany(tenantId ? { where: { tenantId } } : undefined);
  }

  findOne(id: string) {
    return this.prisma.payrollPeriod.findUniqueOrThrow({ where: { id } });
  }

  create(data: CreatePayrollPeriodDto) {
    return this.prisma.payrollPeriod.create({ data: data as any });
  }

  update(id: string, data: UpdatePayrollPeriodDto) {
    return this.prisma.payrollPeriod.update({ where: { id }, data: data as any });
  }

  remove(id: string) {
    return this.prisma.payrollPeriod.delete({ where: { id } });
  }
}
