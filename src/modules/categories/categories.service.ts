import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { paginate, skipFor } from '../../common/utils/pagination';
import { CreateCategoryDto } from './dto/create-category.dto';
import { UpdateCategoryDto } from './dto/update-category.dto';
import { QueryCategoryDto } from './dto/query-category.dto';
import type { Category, Prisma } from '../../../generated/prisma/client';

// Guards against an infinite walk if bad data ever produces a parent cycle in the DB.
// Same value iKiotMS-BE's CategoryService used.
const MAX_DEPTH = 20;

export interface CategoryNode extends Category {
  children: CategoryNode[];
}

/**
 * Ported from iKiotMS-BE's CategoryService. Like brands, categories became tenant-scoped
 * in the port. The tree/breadcrumb/cycle handling is carried over as-is — the frontend's
 * category picker depends on all three.
 */
@Injectable()
export class CategoryService {
  constructor(private readonly prisma: PrismaService) {}

  async findAll(tenantId: string, query: QueryCategoryDto) {
    const where: Prisma.CategoryWhereInput = { tenantId };
    if (query.search) {
      where.name = { contains: query.search, mode: 'insensitive' };
    }
    if (query.parentId !== undefined) {
      where.parentId = query.parentId;
    }

    const [data, total] = await Promise.all([
      this.prisma.category.findMany({
        where,
        include: { parent: { select: { id: true, name: true } } },
        orderBy: { createdAt: 'desc' },
        skip: skipFor(query.page, query.limit),
        take: query.limit,
      }),
      this.prisma.category.count({ where }),
    ]);

    return paginate(data, total, query.page, query.limit);
  }

  /**
   * The whole category forest in one query, assembled in memory. A category tree is small
   * and read constantly, so this stays a single round trip rather than a recursive CTE.
   */
  async findTree(tenantId: string): Promise<CategoryNode[]> {
    const categories = await this.prisma.category.findMany({
      where: { tenantId },
      orderBy: { name: 'asc' },
    });

    const byId = new Map<string, CategoryNode>(
      categories.map((c) => [c.id, { ...c, children: [] }]),
    );

    const roots: CategoryNode[] = [];
    for (const category of categories) {
      const node = byId.get(category.id)!;
      const parent = category.parentId
        ? byId.get(category.parentId)
        : undefined;
      // A category whose parent is missing (or outside this tenant) is shown at the top
      // rather than dropped, so a data problem can never hide products from the picker.
      if (parent) parent.children.push(node);
      else roots.push(node);
    }
    return roots;
  }

  private async findRow(tenantId: string, id: string): Promise<Category> {
    const category = await this.prisma.category.findFirst({
      where: { id, tenantId },
    });
    if (!category) throw new NotFoundException('Không tìm thấy danh mục');
    return category;
  }

  /**
   * Every category in the tenant, keyed by id.
   *
   * Walking a parent chain used to mean one query per level — up to MAX_DEPTH round trips
   * for a single request, in both `findOne` and `assertNoCycle`. `findTree` already
   * proved the whole forest fits comfortably in one query (a tenant's categories number in
   * the dozens), so the walks read from that instead.
   */
  private async categoriesById(
    tenantId: string,
  ): Promise<Map<string, Category>> {
    const categories = await this.prisma.category.findMany({
      where: { tenantId },
    });
    return new Map(categories.map((category) => [category.id, category]));
  }

  /**
   * The chain from `startFromId` up to its root, root first, `startFromId` itself
   * included. Stops at MAX_DEPTH so bad data that somehow produced a parent cycle in the
   * DB can't spin forever.
   */
  private ancestorsOf(
    byId: Map<string, Category>,
    startFromId: string | null,
  ): Category[] {
    const ancestors: Category[] = [];
    let cursor = startFromId;
    for (let depth = 0; cursor && depth < MAX_DEPTH; depth++) {
      const parent = byId.get(cursor);
      if (!parent) break;
      ancestors.unshift(parent);
      cursor = parent.parentId;
    }
    return ancestors;
  }

  /** Detail plus the ancestor chain, root first, as the old API returned it. */
  async findOne(tenantId: string, id: string) {
    const category = await this.prisma.category.findFirst({
      where: { id, tenantId },
      include: { parent: { select: { id: true, name: true } } },
    });
    if (!category) throw new NotFoundException('Không tìm thấy danh mục');

    const byId = await this.categoriesById(tenantId);
    const breadcrumbs = this.ancestorsOf(byId, category.parentId).map(
      (ancestor) => ({ id: ancestor.id, name: ancestor.name }),
    );

    return { ...category, breadcrumbs };
  }

  /** A parent must exist and belong to the same tenant, or the hierarchy leaks across tenants. */
  private async assertParentExists(tenantId: string, parentId: string) {
    const parent = await this.prisma.category.findFirst({
      where: { id: parentId, tenantId },
    });
    if (!parent) throw new BadRequestException('Danh mục cha không tồn tại');
  }

  /**
   * Refuses to hang a category under itself or under one of its own descendants — that
   * would detach the whole subtree from every root and make it unreachable in the tree.
   */
  private async assertNoCycle(
    tenantId: string,
    categoryId: string,
    newParentId: string,
  ) {
    if (categoryId === newParentId) {
      throw new BadRequestException('Danh mục không thể là cha của chính nó');
    }

    // The chain the category would hang under, the proposed parent included. If it passes
    // through the category itself, the move would loop.
    const byId = await this.categoriesById(tenantId);
    const wouldBeAncestors = this.ancestorsOf(byId, newParentId);
    if (wouldBeAncestors.some((ancestor) => ancestor.id === categoryId)) {
      throw new BadRequestException(
        'Không thể đặt danh mục con làm danh mục cha',
      );
    }
  }

  async create(tenantId: string, dto: CreateCategoryDto) {
    if (dto.parentId) await this.assertParentExists(tenantId, dto.parentId);
    return this.prisma.category.create({ data: { ...dto, tenantId } });
  }

  async update(tenantId: string, id: string, dto: UpdateCategoryDto) {
    await this.findRow(tenantId, id);

    if (dto.parentId) {
      await this.assertParentExists(tenantId, dto.parentId);
      await this.assertNoCycle(tenantId, id, dto.parentId);
    }

    return this.prisma.category.update({ where: { id }, data: dto });
  }

  async remove(tenantId: string, id: string) {
    await this.findRow(tenantId, id);

    // Category.parentId is onDelete: Restrict and Product.categoryId is a plain FK, so
    // both of these would otherwise come back as an unhandled constraint violation.
    const [children, products] = await Promise.all([
      this.prisma.category.count({ where: { parentId: id } }),
      this.prisma.product.count({ where: { categoryId: id } }),
    ]);
    if (children > 0) {
      throw new BadRequestException(
        `Không thể xoá danh mục vì đang có ${children} danh mục con`,
      );
    }
    if (products > 0) {
      throw new BadRequestException(
        `Không thể xoá danh mục vì đang có ${products} sản phẩm sử dụng`,
      );
    }

    return this.prisma.category.delete({ where: { id } });
  }
}
