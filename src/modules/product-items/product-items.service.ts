import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateProductItemDto } from './dto/create-product-items.dto';
import { UpdateProductItemDto } from './dto/update-product-items.dto';

@Injectable()
export class ProductItemService {
  constructor(private readonly prisma: PrismaService) {}

  findAll(tenantId?: string) {
    return this.prisma.productItem.findMany(tenantId ? { where: { tenantId } } : undefined);
  }

  findOne(id: string) {
    return this.prisma.productItem.findUniqueOrThrow({ where: { id } });
  }

  create(data: CreateProductItemDto) {
    return this.prisma.productItem.create({ data: data as any });
  }

  update(id: string, data: UpdateProductItemDto) {
    return this.prisma.productItem.update({ where: { id }, data: data as any });
  }

  remove(id: string) {
    return this.prisma.productItem.delete({ where: { id } });
  }
}
