import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateShiftTemplateDto } from './dto/create-shift-templates.dto';
import { UpdateShiftTemplateDto } from './dto/update-shift-templates.dto';

@Injectable()
export class ShiftTemplateService {
  constructor(private readonly prisma: PrismaService) {}

  findAll(tenantId?: string) {
    return this.prisma.shiftTemplate.findMany(tenantId ? { where: { tenantId } } : undefined);
  }

  findOne(id: string) {
    return this.prisma.shiftTemplate.findUniqueOrThrow({ where: { id } });
  }

  create(data: CreateShiftTemplateDto) {
    return this.prisma.shiftTemplate.create({ data: data as any });
  }

  update(id: string, data: UpdateShiftTemplateDto) {
    return this.prisma.shiftTemplate.update({ where: { id }, data: data as any });
  }

  remove(id: string) {
    return this.prisma.shiftTemplate.delete({ where: { id } });
  }
}
