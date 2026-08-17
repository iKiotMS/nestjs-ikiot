import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { CreatePromotionLogDto } from './dto/create-promotion-logs.dto';
import { UpdatePromotionLogDto } from './dto/update-promotion-logs.dto';

@Injectable()
export class PromotionLogService {
  constructor(private readonly prisma: PrismaService) {}

  findAll(tenantId?: string) {
    return this.prisma.promotionLog.findMany({
      where: { ...(tenantId ? { tenantId } : {}) },
    });
  }

  // findFirst + explicit throw rather than findFirstOrThrow: Prisma's own not-found error
  // isn't an HttpException, so Nest turns it into a 500. A row in another tenant must be
  // indistinguishable from one that doesn't exist — 404 either way, never 403.
  async findOne(tenantId: string | undefined, id: string) {
    const found = await this.prisma.promotionLog.findFirst({
      where: { id, ...(tenantId ? { tenantId } : {}) },
    });
    if (!found) throw new NotFoundException('PromotionLog not found');
    return found;
  }

  create(tenantId: string, actorId: string, data: CreatePromotionLogDto) {
    return this.prisma.promotionLog.create({
      data: { ...data, tenantId, createdById: actorId },
    });
  }

  async update(
    tenantId: string | undefined,
    id: string,
    data: UpdatePromotionLogDto,
  ) {
    await this.findOne(tenantId, id);
    return this.prisma.promotionLog.update({ where: { id }, data });
  }

  async remove(tenantId: string | undefined, id: string) {
    await this.findOne(tenantId, id);
    return this.prisma.promotionLog.delete({ where: { id } });
  }
}
