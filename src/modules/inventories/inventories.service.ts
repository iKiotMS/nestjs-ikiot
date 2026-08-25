import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { NotificationService } from '../notifications/notifications.service';
import { InventoryNotificationTemplates } from '../notifications/templates/inventory.templates';
import {
  locationWhere,
  toLocationColumns,
  toLocationRef,
} from '../../common/dto/location-ref.dto';
import type {
  LocationColumns,
  LocationRefDto,
} from '../../common/dto/location-ref.dto';
import { paginate, skipFor } from '../../common/utils/pagination';
import { crossedLowStock } from './low-stock';
import { QueryInventoryDto } from './dto/query-inventory.dto';
import { AddProductToLocationDto } from './dto/add-product-to-location.dto';
import type { Inventory, Prisma } from '../../../generated/prisma/client';

const PRODUCT_ITEM_SELECT = {
  id: true,
  sku: true,
  productName: true,
  productCode: true,
  barcode: true,
  images: { select: { url: true, isThumbnail: true, position: true } },
  details: { select: { name: true, value: true, position: true } },
} as const;

type InventoryRow = Prisma.InventoryGetPayload<{
  include: { productItem: { select: typeof PRODUCT_ITEM_SELECT } };
}>;

/**
 * Ported from iKiotMS-BE's InventoryService (src/modules/inventory/service).
 *
 * Two audiences: the four `/inventory` routes a human uses, and the stock primitives
 * (`adjustStock`, `lowStockCrossing`, `notifyLowStock`) that Order and StockMovement will
 * call once those modules get their real port. The primitives are here rather than in the
 * calling modules deliberately — "what happens to stock, and when do we warn about it" is
 * one rule, and duplicating it across sales and transfers is how the two end up disagreeing.
 */
@Injectable()
export class InventoryService {
  private readonly logger = new Logger(InventoryService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationService,
  ) {}

  private toResponse(row: InventoryRow) {
    const { branchId, warehouseId, ...rest } = row;
    return { ...rest, location: toLocationRef({ branchId, warehouseId }) };
  }

  async findAll(tenantId: string, query: QueryInventoryDto) {
    const where: Prisma.InventoryWhereInput = {
      tenantId,
      ...locationWhere(query),
    };

    if (query.isLowStock) {
      // A row is "low" against its own threshold, not a hardcoded number. minStock = 0
      // means the alert is switched off for that line, so those are excluded rather than
      // matching everything.
      where.minStock = { gt: 0 };
      where.stock = { lte: this.prisma.inventory.fields.minStock };
    }

    if (query.search) {
      where.productItem = {
        OR: [
          { sku: { contains: query.search, mode: 'insensitive' } },
          { productName: { contains: query.search, mode: 'insensitive' } },
        ],
      };
    }

    const [rows, total] = await Promise.all([
      this.prisma.inventory.findMany({
        where,
        include: { productItem: { select: PRODUCT_ITEM_SELECT } },
        orderBy: { updatedAt: 'desc' },
        skip: skipFor(query.page, query.limit),
        take: query.limit,
      }),
      this.prisma.inventory.count({ where }),
    ]);

    return paginate(
      rows.map((row) => this.toResponse(row)),
      total,
      query.page,
      query.limit,
    );
  }

  /** Always scoped by tenant — a row in another tenant must read as nonexistent. */
  private async findRow(tenantId: string, id: string): Promise<InventoryRow> {
    const row = await this.prisma.inventory.findFirst({
      where: { id, tenantId },
      include: { productItem: { select: PRODUCT_ITEM_SELECT } },
    });
    if (!row) throw new NotFoundException('Không tìm thấy dòng tồn kho');
    return row;
  }

  /**
   * Set the low-stock threshold for one line. `0` switches the alert off for that item at
   * that location.
   */
  async updateMinStock(tenantId: string, id: string, minStock: number) {
    await this.findRow(tenantId, id);
    const row = await this.prisma.inventory.update({
      where: { id },
      data: { minStock },
      include: { productItem: { select: PRODUCT_ITEM_SELECT } },
    });
    return this.toResponse(row);
  }

  /** Start stocking a variant at a location, at zero. */
  async addProductToLocation(tenantId: string, dto: AddProductToLocationDto) {
    const columns = toLocationColumns(dto);
    await this.assertLocationsExist(tenantId, [columns]);

    const productItem = await this.prisma.productItem.findFirst({
      where: { id: dto.productItemId, tenantId },
      select: { id: true },
    });
    if (!productItem) {
      throw new NotFoundException('Không tìm thấy mặt hàng');
    }

    const existing = await this.prisma.inventory.findFirst({
      where: { tenantId, productItemId: dto.productItemId, ...columns },
      select: { id: true },
    });
    if (existing) {
      throw new ConflictException('Mặt hàng đã có tại địa điểm này');
    }

    const row = await this.prisma.inventory.create({
      data: {
        tenantId,
        productItemId: dto.productItemId,
        ...columns,
        stock: 0,
        minStock: 0,
      },
      include: { productItem: { select: PRODUCT_ITEM_SELECT } },
    });
    return this.toResponse(row);
  }

  /** Stop stocking a variant at a location. Refuses while any stock is left there. */
  async removeProductFromLocation(tenantId: string, id: string) {
    const existing = await this.findRow(tenantId, id);
    if (existing.stock > 0) {
      throw new BadRequestException(
        `Không thể gỡ mặt hàng khỏi địa điểm khi còn ${existing.stock} tồn kho. Hãy chuyển hoặc bán hết trước.`,
      );
    }

    await this.prisma.inventory.delete({ where: { id } });
    // `{ success: true }` is what iKiotMS-BE answered here and what the frontend checks.
    return { success: true };
  }

  // ─── Stock primitives, for Order / StockMovement ────────────────────────────

  /**
   * Add to (or subtract from) one line's stock, creating the line if the location doesn't
   * stock the item yet.
   *
   * Runs inside the caller's transaction — pass the transactional client, not
   * `this.prisma`, or a rolled-back sale will still have moved stock. Returns the row
   * *after* the change so the caller can hand it to `lowStockCrossing`.
   *
   * **One statement, on purpose.** iKiotMS-BE used an upserting `$inc`, and this has to
   * stay equivalent: a read-then-create leaves a window where two receipts into a location
   * that doesn't stock the item yet both see nothing and both insert, and one of them dies
   * on the unique index. The increment path is atomic either way; it is the *first* write
   * for a given (location, item) that needs the upsert.
   *
   * Which of the two unique indexes to use depends on which end is set. That is not a
   * detail to work around: in Postgres a unique index containing a NULL doesn't constrain
   * anything, so `(tenant, branch, item)` only does its job for branch rows and
   * `(tenant, warehouse, item)` only for warehouse rows. Each row is covered by exactly
   * one of them, which is the one named here.
   */
  async adjustStock(
    tx: Prisma.TransactionClient,
    args: {
      tenantId: string;
      productItemId: string;
      branchId: string | null;
      warehouseId: string | null;
      delta: number;
    },
  ): Promise<Inventory | null> {
    if (!args.delta) return null;

    const create = {
      tenantId: args.tenantId,
      productItemId: args.productItemId,
      branchId: args.branchId,
      warehouseId: args.warehouseId,
      stock: args.delta,
      minStock: 0,
    };
    const update = { stock: { increment: args.delta } };

    if (args.branchId) {
      return tx.inventory.upsert({
        where: {
          tenantId_branchId_productItemId: {
            tenantId: args.tenantId,
            branchId: args.branchId,
            productItemId: args.productItemId,
          },
        },
        create,
        update,
      });
    }

    if (!args.warehouseId) {
      throw new BadRequestException(
        'Điều chỉnh tồn kho phải chỉ rõ chi nhánh hoặc kho',
      );
    }

    return tx.inventory.upsert({
      where: {
        tenantId_warehouseId_productItemId: {
          tenantId: args.tenantId,
          warehouseId: args.warehouseId,
          productItemId: args.productItemId,
        },
      },
      create,
      update,
    });
  }

  /**
   * Did this change just push a line *through* its threshold? See `crossedLowStock` — the
   * rule itself lives in `low-stock.ts` so it can be tested without a database.
   */
  lowStockCrossing(after: Inventory | null, delta: number): Inventory | null {
    return crossedLowStock(after, delta);
  }

  /**
   * Warn whoever manages that location.
   *
   * **Call this after the transaction commits.** A rolled-back sale must not leave behind
   * a warning about a stock level that never happened. It also never throws: the stock has
   * already moved and the sale already succeeded by the time this runs, so a failure here
   * (a deleted variant, a dropped connection) must not surface as a failed sale.
   */
  async notifyLowStock(crossings: (Inventory | null)[]): Promise<void> {
    try {
      for (const inventory of crossings.filter(
        (row): row is Inventory => row !== null,
      )) {
        const [recipients, item] = await Promise.all([
          this.notifications.managersOfLocation({
            tenantId: inventory.tenantId,
            branchId: inventory.branchId,
            warehouseId: inventory.warehouseId,
          }),
          this.prisma.productItem.findUnique({
            where: { id: inventory.productItemId },
            select: { sku: true, productName: true },
          }),
        ]);

        await this.notifications.notify({
          tenantId: inventory.tenantId,
          recipientIds: recipients,
          referenceId: inventory.id,
          ...InventoryNotificationTemplates.lowStock({
            label: item?.productName ?? item?.sku ?? 'Một mặt hàng',
            stock: inventory.stock,
            minStock: inventory.minStock,
          }),
        });
      }
    } catch (error) {
      this.logger.error(
        'Failed to send low-stock warnings',
        error instanceof Error ? error.stack : error,
      );
    }
  }

  /**
   * Create the inventory lines a brand-new variant starts life with. Runs inside the
   * caller's transaction — ProductService creates the variant and its opening stock
   * together, so a failure here must take the variant with it.
   */
  async initializeStock(
    tx: Prisma.TransactionClient,
    tenantId: string,
    productItemId: string,
    initialStock: (LocationRefDto & { stock?: number })[],
  ): Promise<void> {
    if (initialStock.length === 0) return;

    await tx.inventory.createMany({
      data: initialStock.map((entry) => ({
        tenantId,
        productItemId,
        ...toLocationColumns(entry),
        stock: entry.stock ?? 0,
        minStock: 0,
      })),
    });
  }

  /**
   * Every location a request names has to exist inside the caller's tenant.
   *
   * The foreign key would catch a made-up id on its own, but only as a constraint error
   * with nothing useful to show — and, more importantly, it would happily accept another
   * tenant's branch, since the FK knows nothing about tenants. Batched because a single
   * product create can name a location per variant.
   */
  async assertLocationsExist(
    tenantId: string,
    refs: LocationColumns[],
  ): Promise<void> {
    const branchIds = [
      ...new Set(refs.map((ref) => ref.branchId).filter((id) => id !== null)),
    ];
    const warehouseIds = [
      ...new Set(
        refs.map((ref) => ref.warehouseId).filter((id) => id !== null),
      ),
    ];

    const [branches, warehouses] = await Promise.all([
      branchIds.length
        ? this.prisma.branch.count({
            where: { tenantId, id: { in: branchIds } },
          })
        : 0,
      warehouseIds.length
        ? this.prisma.warehouse.count({
            where: { tenantId, id: { in: warehouseIds } },
          })
        : 0,
    ]);

    if (branches !== branchIds.length) {
      throw new NotFoundException('Không tìm thấy chi nhánh');
    }
    if (warehouses !== warehouseIds.length) {
      throw new NotFoundException('Không tìm thấy kho');
    }
  }
}
