import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateLeaveRequestDto } from './dto/create-leave-requests.dto';
import { UpdateLeaveRequestDto } from './dto/update-leave-requests.dto';

@Injectable()
export class LeaveRequestService {
  constructor(private readonly prisma: PrismaService) {}

  findAll(tenantId?: string) {
    return this.prisma.leaveRequest.findMany({
      where: { ...(tenantId ? { tenantId } : {}) },
    });
  }

  // findFirst + explicit throw rather than findFirstOrThrow: Prisma's own not-found error
  // isn't an HttpException, so Nest turns it into a 500. A row in another tenant must be
  // indistinguishable from one that doesn't exist — 404 either way, never 403.
  async findOne(tenantId: string | undefined, id: string) {
    const found = await this.prisma.leaveRequest.findFirst({
      where: { id, ...(tenantId ? { tenantId } : {}) },
    });
    if (!found) throw new NotFoundException('LeaveRequest not found');
    return found;
  }

  create(tenantId: string, actorId: string, data: CreateLeaveRequestDto) {
    return this.prisma.leaveRequest.create({
      data: { ...data, tenantId, userId: actorId },
    });
  }

  async update(
    tenantId: string | undefined,
    id: string,
    data: UpdateLeaveRequestDto,
  ) {
    await this.findOne(tenantId, id);
    return this.prisma.leaveRequest.update({ where: { id }, data });
  }

  async remove(tenantId: string | undefined, id: string) {
    await this.findOne(tenantId, id);
    return this.prisma.leaveRequest.delete({ where: { id } });
  }
}
