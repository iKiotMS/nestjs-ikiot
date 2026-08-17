import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateWorkingScheduleDto } from './dto/create-working-schedules.dto';
import { UpdateWorkingScheduleDto } from './dto/update-working-schedules.dto';

@Injectable()
export class WorkingScheduleService {
  constructor(private readonly prisma: PrismaService) {}

  findAll(tenantId?: string) {
    return this.prisma.workingSchedule.findMany({
      where: { ...(tenantId ? { tenantId } : {}) },
    });
  }

  // findFirst + explicit throw rather than findFirstOrThrow: Prisma's own not-found error
  // isn't an HttpException, so Nest turns it into a 500. A row in another tenant must be
  // indistinguishable from one that doesn't exist — 404 either way, never 403.
  async findOne(tenantId: string | undefined, id: string) {
    const found = await this.prisma.workingSchedule.findFirst({
      where: { id, ...(tenantId ? { tenantId } : {}) },
    });
    if (!found) throw new NotFoundException('WorkingSchedule not found');
    return found;
  }

  create(tenantId: string, actorId: string, data: CreateWorkingScheduleDto) {
    return this.prisma.workingSchedule.create({
      data: { ...data, tenantId, createdById: actorId },
    });
  }

  async update(
    tenantId: string | undefined,
    id: string,
    data: UpdateWorkingScheduleDto,
  ) {
    await this.findOne(tenantId, id);
    return this.prisma.workingSchedule.update({ where: { id }, data });
  }

  async remove(tenantId: string | undefined, id: string) {
    await this.findOne(tenantId, id);
    return this.prisma.workingSchedule.delete({ where: { id } });
  }
}
