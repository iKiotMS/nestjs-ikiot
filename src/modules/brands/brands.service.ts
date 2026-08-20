import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { paginate, skipFor } from '../../common/utils/pagination';
import { CreateBrandDto } from './dto/create-brand.dto';
import { UpdateBrandDto } from './dto/update-brand.dto';
import { QueryBrandDto } from './dto/query-brand.dto';
import type { Prisma } from '../../../generated/prisma/client';

/**
 * Ported from iKiotMS-BE's BrandService. A brand is a product attribute, so this stays
 * plain CRUD — but two things changed in the port:
 *   - brands are tenant-scoped now (the Mongoose model had no tenantId even though
 *     permissions.json granted per-tenant roles full CRUD over them, so one tenant could
 *     rename or delete another's brands);
 *   - delete refuses while products still reference the brand, instead of letting the
 *     foreign key surface as a 500.
 */
@Injectable()
export class BrandService {
  constructor(private readonly prisma: PrismaService) {}

  async findAll(tenantId: string, query: QueryBrandDto) {
    const where: Prisma.BrandWhereInput = { tenantId };
    if (query.search) {
      where.name = { contains: query.search, mode: 'insensitive' };
    }

    const [data, total] = await Promise.all([
      this.prisma.brand.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: skipFor(query.page, query.limit),
        take: query.limit,
      }),
      this.prisma.brand.count({ where }),
    ]);

    return paginate(data, total, query.page, query.limit);
  }

  async findOne(tenantId: string, id: string) {
    const brand = await this.prisma.brand.findFirst({
      where: { id, tenantId },
    });
    if (!brand) throw new NotFoundException('Không tìm thấy thương hiệu');
    return brand;
  }

  create(tenantId: string, dto: CreateBrandDto) {
    return this.prisma.brand.create({ data: { ...dto, tenantId } });
  }

  async update(tenantId: string, id: string, dto: UpdateBrandDto) {
    await this.findOne(tenantId, id);
    return this.prisma.brand.update({ where: { id }, data: dto });
  }

  async remove(tenantId: string, id: string) {
    await this.findOne(tenantId, id);

    const productCount = await this.prisma.product.count({
      where: { brandId: id },
    });
    if (productCount > 0) {
      throw new BadRequestException(
        `Không thể xoá thương hiệu vì đang có ${productCount} sản phẩm sử dụng`,
      );
    }

    return this.prisma.brand.delete({ where: { id } });
  }
}
