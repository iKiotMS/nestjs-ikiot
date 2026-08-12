import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateBranchDto } from './dto/create-branches.dto';
import { UpdateBranchDto } from './dto/update-branches.dto';

@Injectable()
export class BranchService {
  constructor(private readonly prisma: PrismaService) {}

  findAll(tenantId?: string) {
    return this.prisma.branch.findMany(tenantId ? { where: { tenantId } } : undefined);
  }

  findOne(id: string) {
    return this.prisma.branch.findUniqueOrThrow({ where: { id } });
  }

  create(data: CreateBranchDto) {
    return this.prisma.branch.create({ data: data as any });
  }

  update(id: string, data: UpdateBranchDto) {
    return this.prisma.branch.update({ where: { id }, data: data as any });
  }

  remove(id: string) {
    return this.prisma.branch.delete({ where: { id } });
  }
}
