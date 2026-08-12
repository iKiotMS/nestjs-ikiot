import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateCashDrawerSessionDto } from './dto/create-cash-drawer-sessions.dto';
import { UpdateCashDrawerSessionDto } from './dto/update-cash-drawer-sessions.dto';

@Injectable()
export class CashDrawerSessionService {
  constructor(private readonly prisma: PrismaService) {}

  findAll(tenantId?: string) {
    return this.prisma.cashDrawerSession.findMany(tenantId ? { where: { tenantId } } : undefined);
  }

  findOne(id: string) {
    return this.prisma.cashDrawerSession.findUniqueOrThrow({ where: { id } });
  }

  create(data: CreateCashDrawerSessionDto) {
    return this.prisma.cashDrawerSession.create({ data: data as any });
  }

  update(id: string, data: UpdateCashDrawerSessionDto) {
    return this.prisma.cashDrawerSession.update({ where: { id }, data: data as any });
  }

  remove(id: string) {
    return this.prisma.cashDrawerSession.delete({ where: { id } });
  }
}
