import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { CreatePlanDto } from './dto/create-plans.dto';
import { UpdatePlanDto } from './dto/update-plans.dto';

@Injectable()
export class PlanService {
  constructor(private readonly prisma: PrismaService) {}

  findAll() {
    return this.prisma.plan.findMany(undefined);
  }

  findOne(id: string) {
    return this.prisma.plan.findUniqueOrThrow({ where: { id } });
  }

  create(data: CreatePlanDto) {
    return this.prisma.plan.create({ data: data as any });
  }

  update(id: string, data: UpdatePlanDto) {
    return this.prisma.plan.update({ where: { id }, data: data as any });
  }

  remove(id: string) {
    return this.prisma.plan.delete({ where: { id } });
  }
}
