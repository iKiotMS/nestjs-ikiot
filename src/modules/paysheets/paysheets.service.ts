import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { CreatePaysheetDto } from './dto/create-paysheets.dto';
import { UpdatePaysheetDto } from './dto/update-paysheets.dto';

@Injectable()
export class PaysheetService {
  constructor(private readonly prisma: PrismaService) {}

  findAll(tenantId?: string) {
    return this.prisma.paysheet.findMany(tenantId ? { where: { tenantId } } : undefined);
  }

  findOne(id: string) {
    return this.prisma.paysheet.findUniqueOrThrow({ where: { id } });
  }

  create(data: CreatePaysheetDto) {
    return this.prisma.paysheet.create({ data: data as any });
  }

  update(id: string, data: UpdatePaysheetDto) {
    return this.prisma.paysheet.update({ where: { id }, data: data as any });
  }

  remove(id: string) {
    return this.prisma.paysheet.delete({ where: { id } });
  }
}
