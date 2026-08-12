import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateStockMovementRequestDto } from './dto/create-stock-movement-requests.dto';
import { UpdateStockMovementRequestDto } from './dto/update-stock-movement-requests.dto';

@Injectable()
export class StockMovementRequestService {
  constructor(private readonly prisma: PrismaService) {}

  findAll(tenantId?: string) {
    return this.prisma.stockMovementRequest.findMany(tenantId ? { where: { tenantId } } : undefined);
  }

  findOne(id: string) {
    return this.prisma.stockMovementRequest.findUniqueOrThrow({ where: { id } });
  }

  create(data: CreateStockMovementRequestDto) {
    return this.prisma.stockMovementRequest.create({ data: data as any });
  }

  update(id: string, data: UpdateStockMovementRequestDto) {
    return this.prisma.stockMovementRequest.update({ where: { id }, data: data as any });
  }

  remove(id: string) {
    return this.prisma.stockMovementRequest.delete({ where: { id } });
  }
}
