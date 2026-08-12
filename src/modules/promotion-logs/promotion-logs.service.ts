import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { CreatePromotionLogDto } from './dto/create-promotion-logs.dto';
import { UpdatePromotionLogDto } from './dto/update-promotion-logs.dto';

@Injectable()
export class PromotionLogService {
  constructor(private readonly prisma: PrismaService) {}

  findAll(tenantId?: string) {
    return this.prisma.promotionLog.findMany(tenantId ? { where: { tenantId } } : undefined);
  }

  findOne(id: string) {
    return this.prisma.promotionLog.findUniqueOrThrow({ where: { id } });
  }

  create(data: CreatePromotionLogDto) {
    return this.prisma.promotionLog.create({ data: data as any });
  }

  update(id: string, data: UpdatePromotionLogDto) {
    return this.prisma.promotionLog.update({ where: { id }, data: data as any });
  }

  remove(id: string) {
    return this.prisma.promotionLog.delete({ where: { id } });
  }
}
