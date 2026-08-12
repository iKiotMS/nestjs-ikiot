import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { CreatePayslipDto } from './dto/create-payslips.dto';
import { UpdatePayslipDto } from './dto/update-payslips.dto';

@Injectable()
export class PayslipService {
  constructor(private readonly prisma: PrismaService) {}

  findAll(tenantId?: string) {
    return this.prisma.payslip.findMany(tenantId ? { where: { tenantId } } : undefined);
  }

  findOne(id: string) {
    return this.prisma.payslip.findUniqueOrThrow({ where: { id } });
  }

  create(data: CreatePayslipDto) {
    return this.prisma.payslip.create({ data: data as any });
  }

  update(id: string, data: UpdatePayslipDto) {
    return this.prisma.payslip.update({ where: { id }, data: data as any });
  }

  remove(id: string) {
    return this.prisma.payslip.delete({ where: { id } });
  }
}
