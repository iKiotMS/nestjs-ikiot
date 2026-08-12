import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateBrandDto } from './dto/create-brands.dto';
import { UpdateBrandDto } from './dto/update-brands.dto';

@Injectable()
export class BrandService {
  constructor(private readonly prisma: PrismaService) {}

  findAll(tenantId?: string) {
    return this.prisma.brand.findMany(tenantId ? { where: { tenantId } } : undefined);
  }

  findOne(id: string) {
    return this.prisma.brand.findUniqueOrThrow({ where: { id } });
  }

  create(data: CreateBrandDto) {
    return this.prisma.brand.create({ data: data as any });
  }

  update(id: string, data: UpdateBrandDto) {
    return this.prisma.brand.update({ where: { id }, data: data as any });
  }

  remove(id: string) {
    return this.prisma.brand.delete({ where: { id } });
  }
}
