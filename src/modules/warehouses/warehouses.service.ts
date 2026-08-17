import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateWarehouseDto } from './dto/create-warehouses.dto';
import { UpdateWarehouseDto } from './dto/update-warehouses.dto';

@Injectable()
export class WarehouseService {
  constructor(private readonly prisma: PrismaService) {}

  findAll(tenantId?: string) {
    return this.prisma.warehouse.findMany({
      where: { ...(tenantId ? { tenantId } : {}) },
    });
  }

  // findFirst + explicit throw rather than findFirstOrThrow: Prisma's own not-found error
  // isn't an HttpException, so Nest turns it into a 500. A row in another tenant must be
  // indistinguishable from one that doesn't exist — 404 either way, never 403.
  async findOne(tenantId: string | undefined, id: string) {
    const found = await this.prisma.warehouse.findFirst({
      where: { id, ...(tenantId ? { tenantId } : {}) },
    });
    if (!found) throw new NotFoundException('Warehouse not found');
    return found;
  }

  create(tenantId: string, data: CreateWarehouseDto) {
    return this.prisma.warehouse.create({ data: { ...data, tenantId } });
  }

  async update(
    tenantId: string | undefined,
    id: string,
    data: UpdateWarehouseDto,
  ) {
    await this.findOne(tenantId, id);
    return this.prisma.warehouse.update({ where: { id }, data });
  }

  async remove(tenantId: string | undefined, id: string) {
    await this.findOne(tenantId, id);
    return this.prisma.warehouse.delete({ where: { id } });
  }
}
