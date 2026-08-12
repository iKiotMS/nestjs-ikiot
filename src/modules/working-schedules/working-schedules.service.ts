import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateWorkingScheduleDto } from './dto/create-working-schedules.dto';
import { UpdateWorkingScheduleDto } from './dto/update-working-schedules.dto';

@Injectable()
export class WorkingScheduleService {
  constructor(private readonly prisma: PrismaService) {}

  findAll(tenantId?: string) {
    return this.prisma.workingSchedule.findMany(tenantId ? { where: { tenantId } } : undefined);
  }

  findOne(id: string) {
    return this.prisma.workingSchedule.findUniqueOrThrow({ where: { id } });
  }

  create(data: CreateWorkingScheduleDto) {
    return this.prisma.workingSchedule.create({ data: data as any });
  }

  update(id: string, data: UpdateWorkingScheduleDto) {
    return this.prisma.workingSchedule.update({ where: { id }, data: data as any });
  }

  remove(id: string) {
    return this.prisma.workingSchedule.delete({ where: { id } });
  }
}
