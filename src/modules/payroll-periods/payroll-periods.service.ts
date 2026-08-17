import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { CreatePayrollPeriodDto } from './dto/create-payroll-periods.dto';
import { UpdatePayrollPeriodDto } from './dto/update-payroll-periods.dto';

@Injectable()
export class PayrollPeriodService {
  constructor(private readonly prisma: PrismaService) {}

  findAll(tenantId?: string) {
    return this.prisma.payrollPeriod.findMany({
      where: { ...(tenantId ? { tenantId } : {}) },
    });
  }

  // findFirst + explicit throw rather than findFirstOrThrow: Prisma's own not-found error
  // isn't an HttpException, so Nest turns it into a 500. A row in another tenant must be
  // indistinguishable from one that doesn't exist — 404 either way, never 403.
  async findOne(tenantId: string | undefined, id: string) {
    const found = await this.prisma.payrollPeriod.findFirst({
      where: { id, ...(tenantId ? { tenantId } : {}) },
    });
    if (!found) throw new NotFoundException('PayrollPeriod not found');
    return found;
  }

  create(tenantId: string, data: CreatePayrollPeriodDto) {
    return this.prisma.payrollPeriod.create({ data: { ...data, tenantId } });
  }

  async update(
    tenantId: string | undefined,
    id: string,
    data: UpdatePayrollPeriodDto,
  ) {
    await this.findOne(tenantId, id);
    return this.prisma.payrollPeriod.update({ where: { id }, data });
  }

  async remove(tenantId: string | undefined, id: string) {
    await this.findOne(tenantId, id);
    return this.prisma.payrollPeriod.delete({ where: { id } });
  }
}
