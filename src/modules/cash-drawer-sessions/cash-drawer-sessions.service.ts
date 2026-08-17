import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateCashDrawerSessionDto } from './dto/create-cash-drawer-sessions.dto';
import { UpdateCashDrawerSessionDto } from './dto/update-cash-drawer-sessions.dto';

@Injectable()
export class CashDrawerSessionService {
  constructor(private readonly prisma: PrismaService) {}

  findAll(tenantId?: string) {
    return this.prisma.cashDrawerSession.findMany({
      where: { ...(tenantId ? { tenantId } : {}) },
    });
  }

  // findFirst + explicit throw rather than findFirstOrThrow: Prisma's own not-found error
  // isn't an HttpException, so Nest turns it into a 500. A row in another tenant must be
  // indistinguishable from one that doesn't exist — 404 either way, never 403.
  async findOne(tenantId: string | undefined, id: string) {
    const found = await this.prisma.cashDrawerSession.findFirst({
      where: { id, ...(tenantId ? { tenantId } : {}) },
    });
    if (!found) throw new NotFoundException('CashDrawerSession not found');
    return found;
  }

  create(tenantId: string, data: CreateCashDrawerSessionDto) {
    return this.prisma.cashDrawerSession.create({
      data: { ...data, tenantId },
    });
  }

  async update(
    tenantId: string | undefined,
    id: string,
    data: UpdateCashDrawerSessionDto,
  ) {
    await this.findOne(tenantId, id);
    return this.prisma.cashDrawerSession.update({ where: { id }, data });
  }

  async remove(tenantId: string | undefined, id: string) {
    await this.findOne(tenantId, id);
    return this.prisma.cashDrawerSession.delete({ where: { id } });
  }
}
