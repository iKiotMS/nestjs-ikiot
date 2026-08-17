import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateShiftTemplateDto } from './dto/create-shift-templates.dto';
import { UpdateShiftTemplateDto } from './dto/update-shift-templates.dto';

@Injectable()
export class ShiftTemplateService {
  constructor(private readonly prisma: PrismaService) {}

  findAll(tenantId?: string) {
    return this.prisma.shiftTemplate.findMany({
      where: { ...(tenantId ? { tenantId } : {}) },
    });
  }

  // findFirst + explicit throw rather than findFirstOrThrow: Prisma's own not-found error
  // isn't an HttpException, so Nest turns it into a 500. A row in another tenant must be
  // indistinguishable from one that doesn't exist — 404 either way, never 403.
  async findOne(tenantId: string | undefined, id: string) {
    const found = await this.prisma.shiftTemplate.findFirst({
      where: { id, ...(tenantId ? { tenantId } : {}) },
    });
    if (!found) throw new NotFoundException('ShiftTemplate not found');
    return found;
  }

  create(tenantId: string, data: CreateShiftTemplateDto) {
    return this.prisma.shiftTemplate.create({ data: { ...data, tenantId } });
  }

  async update(
    tenantId: string | undefined,
    id: string,
    data: UpdateShiftTemplateDto,
  ) {
    await this.findOne(tenantId, id);
    return this.prisma.shiftTemplate.update({ where: { id }, data });
  }

  async remove(tenantId: string | undefined, id: string) {
    await this.findOne(tenantId, id);
    return this.prisma.shiftTemplate.delete({ where: { id } });
  }
}
