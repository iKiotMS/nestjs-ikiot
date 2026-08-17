import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateStockMovementRequestDto } from './dto/create-stock-movement-requests.dto';
import { UpdateStockMovementRequestDto } from './dto/update-stock-movement-requests.dto';

@Injectable()
export class StockMovementRequestService {
  constructor(private readonly prisma: PrismaService) {}

  findAll(tenantId?: string) {
    return this.prisma.stockMovementRequest.findMany({
      where: { ...(tenantId ? { tenantId } : {}) },
    });
  }

  // findFirst + explicit throw rather than findFirstOrThrow: Prisma's own not-found error
  // isn't an HttpException, so Nest turns it into a 500. A row in another tenant must be
  // indistinguishable from one that doesn't exist — 404 either way, never 403.
  async findOne(tenantId: string | undefined, id: string) {
    const found = await this.prisma.stockMovementRequest.findFirst({
      where: { id, ...(tenantId ? { tenantId } : {}) },
    });
    if (!found) throw new NotFoundException('StockMovementRequest not found');
    return found;
  }

  create(
    tenantId: string,
    actorId: string,
    data: CreateStockMovementRequestDto,
  ) {
    return this.prisma.stockMovementRequest.create({
      data: { ...data, tenantId, createdById: actorId },
    });
  }

  async update(
    tenantId: string | undefined,
    id: string,
    data: UpdateStockMovementRequestDto,
  ) {
    await this.findOne(tenantId, id);
    return this.prisma.stockMovementRequest.update({ where: { id }, data });
  }

  async remove(tenantId: string | undefined, id: string) {
    await this.findOne(tenantId, id);
    return this.prisma.stockMovementRequest.delete({ where: { id } });
  }
}
