import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateAttendanceDto } from './dto/create-attendances.dto';
import { UpdateAttendanceDto } from './dto/update-attendances.dto';

@Injectable()
export class AttendanceService {
  constructor(private readonly prisma: PrismaService) {}

  findAll(tenantId?: string) {
    return this.prisma.attendance.findMany(tenantId ? { where: { tenantId } } : undefined);
  }

  findOne(id: string) {
    return this.prisma.attendance.findUniqueOrThrow({ where: { id } });
  }

  create(data: CreateAttendanceDto) {
    return this.prisma.attendance.create({ data: data as any });
  }

  update(id: string, data: UpdateAttendanceDto) {
    return this.prisma.attendance.update({ where: { id }, data: data as any });
  }

  remove(id: string) {
    return this.prisma.attendance.delete({ where: { id } });
  }
}
