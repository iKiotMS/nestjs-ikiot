import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateBrandDto } from './dto/create-brands.dto';
import { UpdateBrandDto } from './dto/update-brands.dto';

@Injectable()
export class BrandService {
  constructor(private readonly prisma: PrismaService) {}

  findAll(tenantId?: string) {
    return this.prisma.brand.findMany({
      where: { ...(tenantId ? { tenantId } : {}) },
    });
  }

  // findFirst + explicit throw rather than findFirstOrThrow: Prisma's own not-found error
  // isn't an HttpException, so Nest turns it into a 500. A row in another tenant must be
  // indistinguishable from one that doesn't exist — 404 either way, never 403.
  async findOne(tenantId: string | undefined, id: string) {
    const found = await this.prisma.brand.findFirst({
      where: { id, ...(tenantId ? { tenantId } : {}) },
    });
    if (!found) throw new NotFoundException('Brand not found');
    return found;
  }

  create(tenantId: string, data: CreateBrandDto) {
    return this.prisma.brand.create({ data: { ...data, tenantId } });
  }

  async update(tenantId: string | undefined, id: string, data: UpdateBrandDto) {
    await this.findOne(tenantId, id);
    return this.prisma.brand.update({ where: { id }, data });
  }

  async remove(tenantId: string | undefined, id: string) {
    await this.findOne(tenantId, id);
    return this.prisma.brand.delete({ where: { id } });
  }
}
