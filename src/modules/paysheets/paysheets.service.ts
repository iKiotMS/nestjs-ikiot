import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { CreatePaysheetDto } from './dto/create-paysheets.dto';
import { UpdatePaysheetDto } from './dto/update-paysheets.dto';

@Injectable()
export class PaysheetService {
  constructor(private readonly prisma: PrismaService) {}

  findAll(tenantId?: string) {
    return this.prisma.paysheet.findMany({
      where: { ...(tenantId ? { tenantId } : {}) },
    });
  }

  // findFirst + explicit throw rather than findFirstOrThrow: Prisma's own not-found error
  // isn't an HttpException, so Nest turns it into a 500. A row in another tenant must be
  // indistinguishable from one that doesn't exist — 404 either way, never 403.
  async findOne(tenantId: string | undefined, id: string) {
    const found = await this.prisma.paysheet.findFirst({
      where: { id, ...(tenantId ? { tenantId } : {}) },
    });
    if (!found) throw new NotFoundException('Paysheet not found');
    return found;
  }

  create(tenantId: string, actorId: string, data: CreatePaysheetDto) {
    return this.prisma.paysheet.create({
      data: { ...data, tenantId, createdById: actorId },
    });
  }

  async update(
    tenantId: string | undefined,
    id: string,
    data: UpdatePaysheetDto,
  ) {
    await this.findOne(tenantId, id);
    return this.prisma.paysheet.update({ where: { id }, data });
  }

  async remove(tenantId: string | undefined, id: string) {
    await this.findOne(tenantId, id);
    return this.prisma.paysheet.delete({ where: { id } });
  }
}
