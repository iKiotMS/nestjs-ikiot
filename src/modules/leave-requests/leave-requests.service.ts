import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateLeaveRequestDto } from './dto/create-leave-requests.dto';
import { UpdateLeaveRequestDto } from './dto/update-leave-requests.dto';

@Injectable()
export class LeaveRequestService {
  constructor(private readonly prisma: PrismaService) {}

  findAll(tenantId?: string) {
    return this.prisma.leaveRequest.findMany(tenantId ? { where: { tenantId } } : undefined);
  }

  findOne(id: string) {
    return this.prisma.leaveRequest.findUniqueOrThrow({ where: { id } });
  }

  create(data: CreateLeaveRequestDto) {
    return this.prisma.leaveRequest.create({ data: data as any });
  }

  update(id: string, data: UpdateLeaveRequestDto) {
    return this.prisma.leaveRequest.update({ where: { id }, data: data as any });
  }

  remove(id: string) {
    return this.prisma.leaveRequest.delete({ where: { id } });
  }
}
