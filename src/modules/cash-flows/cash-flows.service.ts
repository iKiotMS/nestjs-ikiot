import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateCashFlowDto } from './dto/create-cash-flows.dto';
import { UpdateCashFlowDto } from './dto/update-cash-flows.dto';

@Injectable()
export class CashFlowService {
  constructor(private readonly prisma: PrismaService) {}

  findAll(tenantId?: string) {
    return this.prisma.cashFlow.findMany({
      where: { ...(tenantId ? { tenantId } : {}) },
    });
  }

  // findFirst + explicit throw rather than findFirstOrThrow: Prisma's own not-found error
  // isn't an HttpException, so Nest turns it into a 500. A row in another tenant must be
  // indistinguishable from one that doesn't exist — 404 either way, never 403.
  async findOne(tenantId: string | undefined, id: string) {
    const found = await this.prisma.cashFlow.findFirst({
      where: { id, ...(tenantId ? { tenantId } : {}) },
    });
    if (!found) throw new NotFoundException('CashFlow not found');
    return found;
  }

  create(tenantId: string, actorId: string, data: CreateCashFlowDto) {
    return this.prisma.cashFlow.create({
      data: { ...data, tenantId, createdById: actorId },
    });
  }

  async update(
    tenantId: string | undefined,
    id: string,
    data: UpdateCashFlowDto,
  ) {
    await this.findOne(tenantId, id);
    return this.prisma.cashFlow.update({ where: { id }, data });
  }

  async remove(tenantId: string | undefined, id: string) {
    await this.findOne(tenantId, id);
    return this.prisma.cashFlow.delete({ where: { id } });
  }
}
