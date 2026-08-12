import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateCashFlowDto } from './dto/create-cash-flows.dto';
import { UpdateCashFlowDto } from './dto/update-cash-flows.dto';

@Injectable()
export class CashFlowService {
  constructor(private readonly prisma: PrismaService) {}

  findAll(tenantId?: string) {
    return this.prisma.cashFlow.findMany(tenantId ? { where: { tenantId } } : undefined);
  }

  findOne(id: string) {
    return this.prisma.cashFlow.findUniqueOrThrow({ where: { id } });
  }

  create(data: CreateCashFlowDto) {
    return this.prisma.cashFlow.create({ data: data as any });
  }

  update(id: string, data: UpdateCashFlowDto) {
    return this.prisma.cashFlow.update({ where: { id }, data: data as any });
  }

  remove(id: string) {
    return this.prisma.cashFlow.delete({ where: { id } });
  }
}
