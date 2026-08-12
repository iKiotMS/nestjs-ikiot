import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateHolidayDto } from './dto/create-holidays.dto';
import { UpdateHolidayDto } from './dto/update-holidays.dto';

@Injectable()
export class HolidayService {
  constructor(private readonly prisma: PrismaService) {}

  findAll(tenantId?: string) {
    return this.prisma.holiday.findMany(tenantId ? { where: { tenantId } } : undefined);
  }

  findOne(id: string) {
    return this.prisma.holiday.findUniqueOrThrow({ where: { id } });
  }

  create(data: CreateHolidayDto) {
    return this.prisma.holiday.create({ data: data as any });
  }

  update(id: string, data: UpdateHolidayDto) {
    return this.prisma.holiday.update({ where: { id }, data: data as any });
  }

  remove(id: string) {
    return this.prisma.holiday.delete({ where: { id } });
  }
}
