import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateAttendanceDto } from './dto/create-attendances.dto';
import { UpdateAttendanceDto } from './dto/update-attendances.dto';

@Injectable()
export class AttendanceService {
  constructor(private readonly prisma: PrismaService) {}

  findAll(tenantId?: string) {
    return this.prisma.attendance.findMany({
      where: { ...(tenantId ? { tenantId } : {}) },
    });
  }

  // findFirst + explicit throw rather than findFirstOrThrow: Prisma's own not-found error
  // isn't an HttpException, so Nest turns it into a 500. A row in another tenant must be
  // indistinguishable from one that doesn't exist — 404 either way, never 403.
  async findOne(tenantId: string | undefined, id: string) {
    const found = await this.prisma.attendance.findFirst({
      where: { id, ...(tenantId ? { tenantId } : {}) },
    });
    if (!found) throw new NotFoundException('Attendance not found');
    return found;
  }

  create(tenantId: string, data: CreateAttendanceDto) {
    return this.prisma.attendance.create({ data: { ...data, tenantId } });
  }

  async update(
    tenantId: string | undefined,
    id: string,
    data: UpdateAttendanceDto,
  ) {
    await this.findOne(tenantId, id);
    return this.prisma.attendance.update({ where: { id }, data });
  }

  async remove(tenantId: string | undefined, id: string) {
    await this.findOne(tenantId, id);
    return this.prisma.attendance.delete({ where: { id } });
  }
}
