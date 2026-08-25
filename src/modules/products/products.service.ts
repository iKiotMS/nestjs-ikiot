import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { SubscriptionService } from '../subscriptions/subscriptions.service';
import { InventoryService } from '../inventories/inventories.service';
import {
  locationWhere,
  toLocationColumns,
  toLocationRef,
} from '../../common/dto/location-ref.dto';
import type { LocationRefQueryDto } from '../../common/dto/location-ref.dto';
import {
  ProductStatus,
  QUOTA_COUNTED_PRODUCT_STATUSES,
} from '../../common/constants/product-status';
import { paginate, skipFor } from '../../common/utils/pagination';
import { CreateProductDto } from './dto/create-product.dto';
import { UpdateProductDto } from './dto/update-product.dto';
import { CreateProductItemDto } from './dto/product-item.dto';
import { UpdateProductItemDto } from './dto/update-product-item.dto';
import {
  QueryProductDto,
  QueryProductItemDto,
  SearchProductDto,
} from './dto/query-product.dto';
import { OPEN_MOVEMENT_STATUSES } from '../stock-movement-requests/stock-movement.constants';
import type { Prisma } from '../../../generated/prisma/client';

const ITEM_INCLUDE = {
  images: {
    select: { id: true, url: true, isThumbnail: true, position: true },
    orderBy: { position: 'asc' },
  },
  details: {
    select: { id: true, name: true, value: true, position: true },
    orderBy: { position: 'asc' },
  },
  suppliers: {
    select: {
      supplier: {
        select: {
          id: true,
          supplierName: true,
          email: true,
          phoneNumber: true,
        },
      },
    },
  },
} as const satisfies Prisma.ProductItemInclude;

type ItemRow = Prisma.ProductItemGetPayload<{ include: typeof ITEM_INCLUDE }>;

/** One location's share of a variant's stock, as the old API shaped it. */
export interface StockDetail {
  inventoryId: string;
  locationId: string;
  locationType: string;
  stock: number;
}

/**
 * Real port of iKiotMS-BE's ProductService (src/modules/product/service).
 *
 * A Product is the catalogue entry; a ProductItem is the sellable variant that carries the
 * price, the SKU and the stock. Almost everything interesting happens at the variant level,
 * which is why the routes are split the way they are.
 *
 * Three deliberate departures from the old version, each fixing something rather than
 * reproducing it:
 *   1. **A subscription is now required to create anything.** The old `createProduct` wrapped
 *      its entire body in `if (subscription)`, so a tenant without one got `undefined` back
 *      and an HTTP 200 — the product was never created and nobody was told.
 *   2. **`categoryName` is derived, not accepted.** It is a denormalized copy; taking it
 *      from the client let a product claim a category it wasn't in.
 *   3. **Deleting a variant checks every table that references it**, not just inventory.
 *      In Mongo the stale references were merely dangling; in Postgres they are foreign
 *      keys, so the old check would have surfaced as a constraint error.
 */
@Injectable()
export class ProductService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly subscriptions: SubscriptionService,
    private readonly inventory: InventoryService,
  ) {}

  // ─── Products ──────────────────────────────────────────────────────────────

  async create(tenantId: string, dto: CreateProductDto) {
    await this.subscriptions.assertQuota(
      tenantId,
      'quotaSnapshotMaxProducts',
      () =>
        this.prisma.product.count({
          where: {
            tenantId,
            status: { in: [...QUOTA_COUNTED_PRODUCT_STATUSES] },
          },
        }),
      'số sản phẩm',
    );

    this.assertNoDuplicateSkusInPayload(dto.items);
    await this.assertSkusAreFree(
      tenantId,
      dto.items.map((item) => item.sku),
    );
    const categoryName = await this.resolveCategoryName(
      tenantId,
      dto.categoryId,
    );
    await this.assertBrandExists(tenantId, dto.brandId);
    await this.assertItemReferencesExist(tenantId, dto.items);

    const productId = await this.prisma.$transaction(async (tx) => {
      const product = await tx.product.create({
        data: {
          tenantId,
          name: dto.name,
          brandId: dto.brandId,
          categoryId: dto.categoryId,
          categoryName,
          status: dto.status ?? ProductStatus.ACTIVE,
          images: { create: this.imageRows(dto.images) },
        },
        select: { id: true },
      });

      for (const item of dto.items) {
        await this.insertItem(tx, tenantId, product.id, item);
      }

      return product.id;
    });

    return this.findOne(tenantId, productId, {});
  }

  async findAll(tenantId: string, query: QueryProductDto) {
    const where = this.buildProductWhere(tenantId, query);
    if (query.search) {
      where.name = { contains: query.search, mode: 'insensitive' };
    }

    const [rows, total] = await Promise.all([
      this.prisma.product.findMany({
        where,
        include: { brand: { select: { id: true, name: true } } },
        orderBy: { createdAt: 'desc' },
        skip: skipFor(query.page, query.limit),
        take: query.limit,
      }),
      this.prisma.product.count({ where }),
    ]);

    // Deliberately no `items` here — a product list is a table of products, and attaching
    // every variant made the payload several times larger for a screen that shows one
    // number. Callers that need variants use /products/search or /products/items.
    const totals = await this.totalStockByProduct(
      tenantId,
      rows.map((row) => row.id),
      query,
    );

    const data = rows.map(({ brand, ...product }) => ({
      ...product,
      brandName: brand?.name ?? null,
      totalStock: totals.get(product.id) ?? 0,
    }));

    return paginate(data, total, query.page, query.limit);
  }

  /**
   * The POS lookup: one term matched against the product name (anywhere) and against every
   * variant's code, SKU and barcode (as a prefix — a cashier types or scans from the
   * start). Unlike `findAll`, this returns the variants inline so a specific SKU can be
   * picked straight out of the result.
   */
  async search(tenantId: string, query: SearchProductDto) {
    const where = this.buildProductWhere(tenantId, query);
    if (query.q) {
      const prefix = { startsWith: query.q, mode: 'insensitive' } as const;
      where.OR = [
        { name: { contains: query.q, mode: 'insensitive' } },
        {
          productItems: {
            some: {
              OR: [
                { productCode: prefix },
                { sku: prefix },
                { barcode: prefix },
              ],
            },
          },
        },
      ];
    }

    const [rows, total] = await Promise.all([
      this.prisma.product.findMany({
        where,
        include: { brand: { select: { id: true, name: true } } },
        orderBy: { createdAt: 'desc' },
        skip: skipFor(query.page, query.limit),
        take: query.limit,
      }),
      this.prisma.product.count({ where }),
    ]);

    const items = await this.prisma.productItem.findMany({
      where: { tenantId, productId: { in: rows.map((row) => row.id) } },
      include: ITEM_INCLUDE,
    });
    const stock = await this.stockByItem(
      tenantId,
      items.map((item) => item.id),
      query,
    );

    const data = rows.map(({ brand, ...product }) => {
      const own = items
        .filter((item) => item.productId === product.id)
        .map((item) => this.toItemResponse(item, stock.get(item.id) ?? []));
      return {
        ...product,
        brandName: brand?.name ?? null,
        items: own,
        totalStock: own.reduce((sum, item) => sum + item.stock, 0),
      };
    });

    return paginate(data, total, query.page, query.limit);
  }

  /**
   * Flat list of variants for pickers that reference a specific SKU (a promotion's product
   * scope, an order line). Capped rather than paginated: it feeds a dropdown, not a table.
   */
  async listItems(tenantId: string, query: QueryProductItemDto) {
    const where: Prisma.ProductItemWhereInput = { tenantId };

    if (query.search) {
      const match = { contains: query.search, mode: 'insensitive' } as const;
      where.OR = [
        { sku: match },
        { productName: match },
        { productCode: match },
      ];
    }

    if (query.branchIds?.length) {
      where.inventories = {
        some: { tenantId, branchId: { in: query.branchIds } },
      };
    }

    return this.prisma.productItem.findMany({
      where,
      select: {
        id: true,
        productId: true,
        productName: true,
        productCode: true,
        sku: true,
      },
      orderBy: { productName: 'asc' },
      take: query.limit,
    });
  }

  /** Detail: the product, every variant, and where each variant's stock sits. */
  async findOne(tenantId: string, id: string, location: LocationRefQueryDto) {
    const product = await this.prisma.product.findFirst({
      where: { id, tenantId },
      include: {
        brand: { select: { id: true, name: true } },
        category: { select: { id: true, name: true } },
        images: {
          select: { id: true, url: true, isThumbnail: true, position: true },
          orderBy: { position: 'asc' },
        },
      },
    });
    if (!product) throw new NotFoundException('Không tìm thấy sản phẩm');

    const items = await this.prisma.productItem.findMany({
      where: { productId: id, tenantId },
      include: ITEM_INCLUDE,
      orderBy: { createdAt: 'asc' },
    });
    const stock = await this.stockByItem(
      tenantId,
      items.map((item) => item.id),
      location,
    );

    const { brand, ...rest } = product;
    const mapped = items.map((item) =>
      this.toItemResponse(item, stock.get(item.id) ?? []),
    );

    return {
      ...rest,
      brandName: brand?.name ?? null,
      items: mapped,
      totalStock: mapped.reduce((sum, item) => sum + item.stock, 0),
    };
  }

  async update(tenantId: string, id: string, dto: UpdateProductDto) {
    // Prisma's update({ where: { id } }) can't take a non-unique tenant filter, so scope
    // has to be re-checked first or any tenant could write any row by id.
    const existing = await this.prisma.product.findFirst({
      where: { id, tenantId },
      select: { id: true },
    });
    if (!existing) throw new NotFoundException('Không tìm thấy sản phẩm');

    await this.assertBrandExists(tenantId, dto.brandId);
    const categoryName =
      dto.categoryId === undefined
        ? undefined
        : await this.resolveCategoryName(tenantId, dto.categoryId);

    await this.prisma.$transaction(async (tx) => {
      await tx.product.update({
        where: { id },
        data: {
          name: dto.name,
          brandId: dto.brandId,
          categoryId: dto.categoryId,
          categoryName,
          status: dto.status,
        },
      });

      if (dto.images) {
        await tx.productImage.deleteMany({ where: { productId: id } });
        await tx.productImage.createMany({
          data: this.imageRows(dto.images).map((image) => ({
            ...image,
            productId: id,
          })),
        });
      }

      // ProductItem.productName is a denormalized copy of the product's name, so it has to
      // follow. The old service did the same.
      if (dto.name) {
        await tx.productItem.updateMany({
          where: { productId: id, tenantId },
          data: { productName: dto.name },
        });
      }
    });

    return this.findOne(tenantId, id, {});
  }

  /**
   * Soft delete: status becomes DISCONTINUED. A hard delete is not an option — order items,
   * stock movements and inventory rows all hold a foreign key to this product's variants.
   *
   * Refuses while the product is still "live" in any sense: stock on a shelf, an unfinished
   * transfer, an unpaid order. All three checks are ported from the old service.
   */
  async discontinue(tenantId: string, id: string) {
    const product = await this.prisma.product.findFirst({
      where: { id, tenantId },
      select: { id: true, status: true },
    });
    if (!product) throw new NotFoundException('Không tìm thấy sản phẩm');
    if (product.status === ProductStatus.DISCONTINUED) {
      throw new BadRequestException('Sản phẩm đã ngừng kinh doanh');
    }

    const itemIds = (
      await this.prisma.productItem.findMany({
        where: { productId: id, tenantId },
        select: { id: true },
      })
    ).map((item) => item.id);

    if (itemIds.length > 0) {
      const [stocked, movements, orders] = await Promise.all([
        this.prisma.inventory.count({
          where: { tenantId, productItemId: { in: itemIds }, stock: { gt: 0 } },
        }),
        this.prisma.stockMovementRequest.count({
          where: {
            tenantId,
            status: { in: [...OPEN_MOVEMENT_STATUSES] },
            // The relation is `details` on StockMovementRequest, `items` on Order.
            details: { some: { productItemId: { in: itemIds } } },
          },
        }),
        this.prisma.order.count({
          where: {
            tenantId,
            status: 'PENDING',
            items: { some: { productItemId: { in: itemIds } } },
          },
        }),
      ]);

      if (stocked > 0) {
        throw new BadRequestException(
          'Không thể ngừng kinh doanh: sản phẩm vẫn còn tồn kho.',
        );
      }
      if (movements > 0) {
        throw new BadRequestException(
          'Không thể ngừng kinh doanh: sản phẩm đang nằm trong phiếu chuyển kho chưa hoàn tất.',
        );
      }
      if (orders > 0) {
        throw new BadRequestException(
          'Không thể ngừng kinh doanh: sản phẩm đang nằm trong đơn hàng chưa thanh toán.',
        );
      }
    }

    await this.prisma.product.update({
      where: { id },
      data: { status: ProductStatus.DISCONTINUED },
    });
    return this.findOne(tenantId, id, {});
  }

  // ─── Variants ──────────────────────────────────────────────────────────────

  async createItem(
    tenantId: string,
    productId: string,
    dto: CreateProductItemDto,
  ) {
    // The old route sat behind requireActiveSubscription. Adding a variant doesn't consume
    // the product quota (that counts products), but it is still a write to the catalogue.
    await this.subscriptions.requireActiveSubscription(tenantId);

    const product = await this.prisma.product.findFirst({
      where: { id: productId, tenantId },
      select: { id: true },
    });
    if (!product) throw new NotFoundException('Không tìm thấy sản phẩm');

    await this.assertSkusAreFree(tenantId, [dto.sku]);
    await this.assertItemReferencesExist(tenantId, [dto]);

    const itemId = await this.prisma.$transaction((tx) =>
      this.insertItem(tx, tenantId, productId, dto),
    );

    return this.findItem(tenantId, itemId);
  }

  async updateItem(
    tenantId: string,
    itemId: string,
    dto: UpdateProductItemDto,
  ) {
    const existing = await this.prisma.productItem.findFirst({
      where: { id: itemId, tenantId },
      select: { id: true },
    });
    if (!existing) throw new NotFoundException('Không tìm thấy mặt hàng');

    if (dto.sku) await this.assertSkusAreFree(tenantId, [dto.sku], itemId);

    await this.prisma.$transaction(async (tx) => {
      await tx.productItem.update({
        where: { id: itemId },
        data: {
          productName: dto.productName,
          productCode: dto.productCode,
          sku: dto.sku,
          barcode: dto.barcode,
          description: dto.description,
          retailPrice: dto.retailPrice,
          costPrice: dto.costPrice,
          warrantyPeriod: dto.warrantyPeriod,
          vat: dto.vat,
        },
      });

      // Both collections are replaced wholesale when present, same as the old API: the
      // client sends the list it wants to end up with, not a patch of it.
      if (dto.images) {
        await tx.productItemImage.deleteMany({
          where: { productItemId: itemId },
        });
        await tx.productItemImage.createMany({
          data: this.imageRows(dto.images).map((image) => ({
            ...image,
            productItemId: itemId,
          })),
        });
      }
      if (dto.productDetails) {
        await tx.productItemDetail.deleteMany({
          where: { productItemId: itemId },
        });
        await tx.productItemDetail.createMany({
          data: dto.productDetails.map((detail, position) => ({
            productItemId: itemId,
            name: detail.name,
            value: detail.value,
            position,
          })),
        });
      }
    });

    return this.findItem(tenantId, itemId);
  }

  /**
   * Hard delete of a variant, refused while anything still points at it.
   *
   * The old service checked inventory only. Here the other three references are real
   * foreign keys, so without these checks the delete would come back as a constraint
   * violation with nothing useful to show the user.
   */
  async removeItem(tenantId: string, itemId: string) {
    const item = await this.prisma.productItem.findFirst({
      where: { id: itemId, tenantId },
      select: { id: true },
    });
    if (!item) throw new NotFoundException('Không tìm thấy mặt hàng');

    const [inventories, movements, orders, promotions] = await Promise.all([
      this.prisma.inventory.count({ where: { productItemId: itemId } }),
      this.prisma.stockMovementRequestItem.count({
        where: { productItemId: itemId },
      }),
      this.prisma.orderItem.count({ where: { productItemId: itemId } }),
      this.prisma.promotionProductItem.count({
        where: { productItemId: itemId },
      }),
    ]);

    if (inventories > 0) {
      throw new BadRequestException(
        'Không thể xoá mặt hàng khi nó vẫn được gán cho một hoặc nhiều địa điểm. Hãy gỡ khỏi tất cả địa điểm trước.',
      );
    }
    if (movements > 0 || orders > 0) {
      throw new BadRequestException(
        'Không thể xoá mặt hàng vì đã phát sinh đơn hàng hoặc phiếu chuyển kho. Hãy ngừng kinh doanh sản phẩm thay vì xoá.',
      );
    }
    if (promotions > 0) {
      throw new BadRequestException(
        'Không thể xoá mặt hàng vì đang nằm trong một chương trình khuyến mãi.',
      );
    }

    // Images, details and supplier links cascade from the schema.
    await this.prisma.productItem.delete({ where: { id: itemId } });
    return { id: itemId, deleted: true };
  }

  /** Idempotent, like the old `$addToSet`: attaching the same supplier twice is a no-op. */
  async addSupplierToItem(
    tenantId: string,
    itemId: string,
    supplierId: string,
  ) {
    const [item, supplier] = await Promise.all([
      this.prisma.productItem.findFirst({
        where: { id: itemId, tenantId },
        select: { id: true },
      }),
      this.prisma.supplier.findFirst({
        where: { id: supplierId, tenantId },
        select: { id: true },
      }),
    ]);
    if (!item) throw new NotFoundException('Không tìm thấy mặt hàng');
    if (!supplier) throw new NotFoundException('Không tìm thấy nhà cung cấp');

    await this.prisma.productItemSupplier.upsert({
      where: {
        productItemId_supplierId: { productItemId: itemId, supplierId },
      },
      create: { productItemId: itemId, supplierId },
      update: {},
    });

    return this.findItem(tenantId, itemId);
  }

  // ─── Internals ─────────────────────────────────────────────────────────────

  private async findItem(tenantId: string, itemId: string) {
    const item = await this.prisma.productItem.findFirst({
      where: { id: itemId, tenantId },
      include: ITEM_INCLUDE,
    });
    if (!item) throw new NotFoundException('Không tìm thấy mặt hàng');

    const stock = await this.stockByItem(tenantId, [itemId], {});
    return this.toItemResponse(item, stock.get(itemId) ?? []);
  }

  /** Creates a variant with its images, specs, supplier links and opening stock. */
  private async insertItem(
    tx: Prisma.TransactionClient,
    tenantId: string,
    productId: string,
    dto: CreateProductItemDto,
  ): Promise<string> {
    const item = await tx.productItem.create({
      data: {
        tenantId,
        productId,
        productName: dto.productName,
        productCode: dto.productCode,
        sku: dto.sku,
        barcode: dto.barcode,
        description: dto.description,
        retailPrice: dto.retailPrice,
        costPrice: dto.costPrice,
        warrantyPeriod: dto.warrantyPeriod,
        vat: dto.vat,
        images: { create: this.imageRows(dto.images) },
        details: {
          create: (dto.productDetails ?? []).map((detail, position) => ({
            name: detail.name,
            value: detail.value,
            position,
          })),
        },
        suppliers: {
          create: (dto.supplierIds ?? []).map((supplierId) => ({ supplierId })),
        },
      },
      select: { id: true },
    });

    await this.inventory.initializeStock(
      tx,
      tenantId,
      item.id,
      dto.initialStock ?? [],
    );

    return item.id;
  }

  private imageRows(images: { url: string; isThumbnail?: boolean }[] = []) {
    return images.map((image, position) => ({
      url: image.url,
      isThumbnail: image.isThumbnail ?? false,
      position,
    }));
  }

  private buildProductWhere(
    tenantId: string,
    query: {
      status?: string;
      categoryId?: string;
      supplierId?: string;
    } & LocationRefQueryDto,
  ): Prisma.ProductWhereInput {
    const where: Prisma.ProductWhereInput = { tenantId };
    if (query.status) where.status = query.status;
    if (query.categoryId) where.categoryId = query.categoryId;

    // "Products this supplier supplies" and "products stocked at this location" are both
    // facts about the variants, so they are relation filters rather than the old service's
    // fetch-ids-then-intersect-in-memory dance.
    const itemConditions: Prisma.ProductItemWhereInput[] = [];
    if (query.supplierId) {
      itemConditions.push({
        suppliers: { some: { supplierId: query.supplierId } },
      });
    }
    const location = locationWhere(query);
    if (Object.keys(location).length > 0) {
      itemConditions.push({ inventories: { some: { tenantId, ...location } } });
    }
    if (itemConditions.length > 0) {
      where.productItems = { some: { AND: itemConditions } };
    }

    return where;
  }

  /**
   * Where each variant's stock sits, one query for the whole page. The location filter is
   * applied here too, so a branch-scoped list reports that branch's stock rather than the
   * tenant-wide total.
   */
  private async stockByItem(
    tenantId: string,
    itemIds: string[],
    location: LocationRefQueryDto,
  ): Promise<Map<string, StockDetail[]>> {
    const byItem = new Map<string, StockDetail[]>();
    if (itemIds.length === 0) return byItem;

    const rows = await this.prisma.inventory.findMany({
      where: {
        tenantId,
        productItemId: { in: itemIds },
        ...locationWhere(location),
      },
      select: {
        id: true,
        productItemId: true,
        stock: true,
        branchId: true,
        warehouseId: true,
      },
    });

    for (const row of rows) {
      const ref = toLocationRef(row);
      if (!ref) continue; // a row naming neither location is broken data, not a location
      const list = byItem.get(row.productItemId) ?? [];
      list.push({ inventoryId: row.id, stock: row.stock, ...ref });
      byItem.set(row.productItemId, list);
    }
    return byItem;
  }

  /** Total stock per product, without loading the variants themselves. */
  private async totalStockByProduct(
    tenantId: string,
    productIds: string[],
    location: LocationRefQueryDto,
  ): Promise<Map<string, number>> {
    const totals = new Map<string, number>();
    if (productIds.length === 0) return totals;

    const rows = await this.prisma.inventory.findMany({
      where: {
        tenantId,
        productItem: { productId: { in: productIds } },
        ...locationWhere(location),
      },
      select: { stock: true, productItem: { select: { productId: true } } },
    });

    for (const row of rows) {
      const productId = row.productItem.productId;
      totals.set(productId, (totals.get(productId) ?? 0) + row.stock);
    }
    return totals;
  }

  /**
   * Prices are `Decimal` in Postgres and would serialize as strings; the old API sent
   * numbers and the frontend does arithmetic on them. Converting here keeps that contract
   * in one place.
   */
  private toItemResponse(item: ItemRow, stockDetails: StockDetail[]) {
    const { suppliers, retailPrice, costPrice, vat, ...rest } = item;
    return {
      ...rest,
      retailPrice: Number(retailPrice),
      costPrice: Number(costPrice),
      vat: vat === null ? null : Number(vat),
      suppliers: suppliers.map((link) => link.supplier),
      stockDetails,
      stock: stockDetails.reduce((sum, detail) => sum + detail.stock, 0),
    };
  }

  private assertNoDuplicateSkusInPayload(items: { sku: string }[]): void {
    const seen = new Set<string>();
    const duplicates = new Set<string>();
    for (const item of items) {
      if (seen.has(item.sku)) duplicates.add(item.sku);
      seen.add(item.sku);
    }
    if (duplicates.size > 0) {
      throw new BadRequestException(
        `SKU bị trùng trong cùng một yêu cầu: ${[...duplicates].join(', ')}`,
      );
    }
  }

  /**
   * `@@unique([tenantId, sku])` would catch this anyway, but as a bare constraint error
   * naming a column. A tenant creating twenty variants deserves to be told which SKU.
   */
  private async assertSkusAreFree(
    tenantId: string,
    skus: string[],
    exceptItemId?: string,
  ): Promise<void> {
    const taken = await this.prisma.productItem.findMany({
      where: {
        tenantId,
        sku: { in: skus },
        ...(exceptItemId ? { id: { not: exceptItemId } } : {}),
      },
      select: { sku: true },
    });
    if (taken.length > 0) {
      throw new ConflictException(
        `SKU đã tồn tại trong cửa hàng: ${taken.map((item) => item.sku).join(', ')}`,
      );
    }
  }

  /** Every location and supplier a batch of variants names has to be in this tenant. */
  private async assertItemReferencesExist(
    tenantId: string,
    items: CreateProductItemDto[],
  ): Promise<void> {
    await this.inventory.assertLocationsExist(
      tenantId,
      items.flatMap((item) =>
        (item.initialStock ?? []).map((entry) => toLocationColumns(entry)),
      ),
    );

    const supplierIds = [
      ...new Set(items.flatMap((item) => item.supplierIds ?? [])),
    ];
    if (supplierIds.length === 0) return;

    const found = await this.prisma.supplier.count({
      where: { tenantId, id: { in: supplierIds } },
    });
    if (found !== supplierIds.length) {
      throw new NotFoundException('Không tìm thấy nhà cung cấp');
    }
  }

  private async assertBrandExists(
    tenantId: string,
    brandId?: string,
  ): Promise<void> {
    if (!brandId) return;
    const brand = await this.prisma.brand.findFirst({
      where: { id: brandId, tenantId },
      select: { id: true },
    });
    if (!brand) throw new NotFoundException('Không tìm thấy thương hiệu');
  }

  /**
   * `Product.categoryName` is a denormalized copy kept for list screens. The server fills
   * it from the category it is actually pointed at — see the class comment for why the
   * client no longer gets to say. `CategoryService` refreshes it when a category is renamed.
   */
  private async resolveCategoryName(
    tenantId: string,
    categoryId?: string,
  ): Promise<string | null> {
    if (!categoryId) return null;
    const category = await this.prisma.category.findFirst({
      where: { id: categoryId, tenantId },
      select: { name: true },
    });
    if (!category) throw new NotFoundException('Không tìm thấy danh mục');
    return category.name;
  }
}
