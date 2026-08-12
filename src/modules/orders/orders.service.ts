import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateOrderDto } from './dto/create-orders.dto';
import { UpdateOrderDto } from './dto/update-orders.dto';

@Injectable()
export class OrderService {
  constructor(private readonly prisma: PrismaService) {}

  findAll(tenantId?: string) {
    return this.prisma.order.findMany(tenantId ? { where: { tenantId } } : undefined);
  }

  findOne(id: string) {
    return this.prisma.order.findUniqueOrThrow({ where: { id } });
  }

  create(data: CreateOrderDto) {
    return this.prisma.order.create({ data: data as any });
  }

  update(id: string, data: UpdateOrderDto) {
    return this.prisma.order.update({ where: { id }, data: data as any });
  }

  remove(id: string) {
    return this.prisma.order.delete({ where: { id } });
  }
}
