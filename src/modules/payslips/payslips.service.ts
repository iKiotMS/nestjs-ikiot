import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { CreatePayslipDto } from './dto/create-payslips.dto';
import { UpdatePayslipDto } from './dto/update-payslips.dto';

@Injectable()
export class PayslipService {
  constructor(private readonly prisma: PrismaService) {}

  findAll(tenantId?: string) {
    return this.prisma.payslip.findMany({
      where: { ...(tenantId ? { tenantId } : {}) },
    });
  }

  // findFirst + explicit throw rather than findFirstOrThrow: Prisma's own not-found error
  // isn't an HttpException, so Nest turns it into a 500. A row in another tenant must be
  // indistinguishable from one that doesn't exist — 404 either way, never 403.
  async findOne(tenantId: string | undefined, id: string) {
    const found = await this.prisma.payslip.findFirst({
      where: { id, ...(tenantId ? { tenantId } : {}) },
    });
    if (!found) throw new NotFoundException('Payslip not found');
    return found;
  }

  create(tenantId: string, data: CreatePayslipDto) {
    return this.prisma.payslip.create({ data: { ...data, tenantId } });
  }

  async update(
    tenantId: string | undefined,
    id: string,
    data: UpdatePayslipDto,
  ) {
    await this.findOne(tenantId, id);
    return this.prisma.payslip.update({ where: { id }, data });
  }

  async remove(tenantId: string | undefined, id: string) {
    await this.findOne(tenantId, id);
    return this.prisma.payslip.delete({ where: { id } });
  }
}
