import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '../../../generated/prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { UpdatePlanDto } from './dto/update-plan.dto';

// Ported from iKiotMS-BE's SubscriptionService (the plan-management half). Deliberately
// no create()/remove() — the old system never exposed those over the API either; plans
// are seeded/managed directly against the database, only editing existing ones is a
// real feature.
@Injectable()
export class PlanService {
  constructor(private readonly prisma: PrismaService) {}

  listActive() {
    return this.prisma.plan.findMany({
      where: { isActive: true },
      orderBy: { price: 'asc' },
    });
  }

  listAll() {
    return this.prisma.plan.findMany({ orderBy: { price: 'asc' } });
  }

  findByCode(planCode: string, activeOnly = true) {
    return this.prisma.plan.findFirst({
      where: { planCode, ...(activeOnly ? { isActive: true } : {}) },
    });
  }

  async update(id: string, dto: UpdatePlanDto) {
    const payload = Object.fromEntries(
      Object.entries(dto).filter(([, v]) => v !== undefined),
    );
    if (Object.keys(payload).length === 0) {
      throw new BadRequestException('No editable fields provided');
    }
    return this.applyUpdate(id, payload);
  }

  setActive(id: string, isActive: boolean) {
    return this.applyUpdate(id, { isActive });
  }

  private async applyUpdate(id: string, data: Prisma.PlanUpdateInput) {
    try {
      return await this.prisma.plan.update({ where: { id }, data });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2025'
      ) {
        throw new NotFoundException('Plan not found');
      }
      throw error;
    }
  }
}
