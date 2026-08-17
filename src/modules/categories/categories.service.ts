import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateCategoryDto } from './dto/create-categories.dto';
import { UpdateCategoryDto } from './dto/update-categories.dto';

@Injectable()
export class CategoryService {
  constructor(private readonly prisma: PrismaService) {}

  findAll(tenantId?: string) {
    return this.prisma.category.findMany({
      where: { ...(tenantId ? { tenantId } : {}) },
    });
  }

  // findFirst + explicit throw rather than findFirstOrThrow: Prisma's own not-found error
  // isn't an HttpException, so Nest turns it into a 500. A row in another tenant must be
  // indistinguishable from one that doesn't exist — 404 either way, never 403.
  async findOne(tenantId: string | undefined, id: string) {
    const found = await this.prisma.category.findFirst({
      where: { id, ...(tenantId ? { tenantId } : {}) },
    });
    if (!found) throw new NotFoundException('Category not found');
    return found;
  }

  create(tenantId: string, data: CreateCategoryDto) {
    return this.prisma.category.create({ data: { ...data, tenantId } });
  }

  async update(
    tenantId: string | undefined,
    id: string,
    data: UpdateCategoryDto,
  ) {
    await this.findOne(tenantId, id);
    return this.prisma.category.update({ where: { id }, data });
  }

  async remove(tenantId: string | undefined, id: string) {
    await this.findOne(tenantId, id);
    return this.prisma.category.delete({ where: { id } });
  }
}
