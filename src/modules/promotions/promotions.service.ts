import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { CreatePromotionDto } from './dto/create-promotions.dto';
import { UpdatePromotionDto } from './dto/update-promotions.dto';

@Injectable()
export class PromotionService {
  constructor(private readonly prisma: PrismaService) {}

  findAll(tenantId?: string) {
    return this.prisma.promotion.findMany(tenantId ? { where: { tenantId } } : undefined);
  }

  findOne(id: string) {
    return this.prisma.promotion.findUniqueOrThrow({ where: { id } });
  }

  create(data: CreatePromotionDto) {
    return this.prisma.promotion.create({ data: data as any });
  }

  update(id: string, data: UpdatePromotionDto) {
    return this.prisma.promotion.update({ where: { id }, data: data as any });
  }

  remove(id: string) {
    return this.prisma.promotion.delete({ where: { id } });
  }
}
