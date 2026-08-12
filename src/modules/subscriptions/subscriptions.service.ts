import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateSubscriptionDto } from './dto/create-subscriptions.dto';
import { UpdateSubscriptionDto } from './dto/update-subscriptions.dto';

@Injectable()
export class SubscriptionService {
  constructor(private readonly prisma: PrismaService) {}

  findAll(tenantId?: string) {
    return this.prisma.subscription.findMany(tenantId ? { where: { tenantId } } : undefined);
  }

  findOne(id: string) {
    return this.prisma.subscription.findUniqueOrThrow({ where: { id } });
  }

  create(data: CreateSubscriptionDto) {
    return this.prisma.subscription.create({ data: data as any });
  }

  update(id: string, data: UpdateSubscriptionDto) {
    return this.prisma.subscription.update({ where: { id }, data: data as any });
  }

  remove(id: string) {
    return this.prisma.subscription.delete({ where: { id } });
  }
}
