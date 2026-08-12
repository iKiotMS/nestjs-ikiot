import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateWarehouseDto } from './dto/create-warehouses.dto';
import { UpdateWarehouseDto } from './dto/update-warehouses.dto';

@Injectable()
export class WarehouseService {
  constructor(private readonly prisma: PrismaService) {}

  findAll(tenantId?: string) {
    return this.prisma.warehouse.findMany(tenantId ? { where: { tenantId } } : undefined);
  }

  findOne(id: string) {
    return this.prisma.warehouse.findUniqueOrThrow({ where: { id } });
  }

  create(data: CreateWarehouseDto) {
    return this.prisma.warehouse.create({ data: data as any });
  }

  update(id: string, data: UpdateWarehouseDto) {
    return this.prisma.warehouse.update({ where: { id }, data: data as any });
  }

  remove(id: string) {
    return this.prisma.warehouse.delete({ where: { id } });
  }
}
