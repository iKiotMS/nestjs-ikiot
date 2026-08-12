import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateInventoryDto } from './dto/create-inventories.dto';
import { UpdateInventoryDto } from './dto/update-inventories.dto';

@Injectable()
export class InventoryService {
  constructor(private readonly prisma: PrismaService) {}

  findAll(tenantId?: string) {
    return this.prisma.inventory.findMany(tenantId ? { where: { tenantId } } : undefined);
  }

  findOne(id: string) {
    return this.prisma.inventory.findUniqueOrThrow({ where: { id } });
  }

  create(data: CreateInventoryDto) {
    return this.prisma.inventory.create({ data: data as any });
  }

  update(id: string, data: UpdateInventoryDto) {
    return this.prisma.inventory.update({ where: { id }, data: data as any });
  }

  remove(id: string) {
    return this.prisma.inventory.delete({ where: { id } });
  }
}
