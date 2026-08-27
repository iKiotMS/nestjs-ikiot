import { Injectable } from '@nestjs/common';
import { Prisma } from '../../../generated/prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { paginate, skipFor } from '../../common/utils/pagination';
import type { AuthUser } from '../../common/types/auth-user.type';
import { locationScope, orderScope } from './stats-scope';
import {
  averageOrderValue,
  changePct,
  previousPeriod,
  type DateRange,
} from './stats-math';
import {
  BUCKET_FORMAT,
  DEFAULT_LOW_STOCK_THRESHOLD,
  FlowType,
  GroupBy,
  LOW_STOCK_LIST_LIMIT,
  REVENUE_STATUS,
  TZ_NAME,
  TopProductsSort,
} from './stats.constants';
import type {
  CashflowListQueryDto,
  CashflowQueryDto,
  InventoryStatsQueryDto,
  RevenueSeriesQueryDto,
  StatsQueryDto,
  TopProductsQueryDto,
} from './dto/stats-query.dto';

/** `COUNT(*)` is `bigint` in Postgres; every count below is cast `::int` at the source. */
interface SummaryRow {
  revenue: Prisma.Decimal;
  orderCount: number;
  customerCount: number;
}

interface BucketRow {
  bucket: string;
  revenue: Prisma.Decimal;
  orderCount: number;
}

/**
 * The same first+last shape `JwtStrategy` and `NotificationService.displayName` build, and
 * `null` when there is no name on file — the old `$lookup` projected null there too, so the
 * client already renders that case.
 */
function fullName(
  user: {
    profileFirstName: string | null;
    profileLastName: string | null;
  } | null,
): string | null {
  if (!user?.profileFirstName) return null;
  return `${user.profileFirstName} ${user.profileLastName ?? ''}`.trim();
}

/**
 * Ported from iKiotMS-BE's `src/modules/stats/service/StatsService.js` — the shop-facing
 * dashboard, eight endpoints at the old paths.
 *
 * **Why some of this is raw SQL.** Three of these answers need an expression Prisma's query
 * builder cannot express: bucketing a timestamp into the shop's local day, summing
 * `unit_price * quantity - discount_amount` across order lines, and valuing stock as
 * `stock * cost_price` across a join. The old code expressed all three as Mongo aggregation
 * pipelines. Doing them in JavaScript instead would mean pulling every order line of the
 * period into memory to add it up, so they stay in the database as `$queryRaw`. Everything
 * that Prisma *can* express (`groupBy`, `aggregate`, `findMany`) uses it.
 *
 * Every raw query interpolates through tagged-template parameters, never string
 * concatenation. The one exception is the `ORDER BY` column in `getTopProducts`, which
 * cannot be a bind parameter — it is chosen from a two-value whitelist, not from the query
 * string.
 */
@Injectable()
export class StatsService {
  constructor(private readonly prisma: PrismaService) {}

  // ─── Orders ────────────────────────────────────────────────────────────────

  /**
   * Headline KPIs with period-over-period change.
   *
   * `customerCount` counts distinct `customer_id`, and every walk-in sale in this system
   * points at the tenant's single `KH_VANGLAI` row — so all anonymous sales together count
   * as one "customer". That is not a rounding error to fix here: the old aggregation
   * `$addToSet`-ed a null `customerId` and arrived at exactly the same +1, so the number on
   * the dashboard is unchanged by the port.
   */
  async getOverview(user: AuthUser, query: StatsQueryDto) {
    const scope = orderScope(user, query.branchId);
    const range = query.range();
    const previous = previousPeriod(range);

    const [current, before] = await Promise.all([
      this.summarize(user, scope, range),
      this.summarize(user, scope, previous),
    ]);

    return {
      ...current,
      changePct: {
        revenue: changePct(current.revenue, before.revenue),
        orderCount: changePct(current.orderCount, before.orderCount),
        customerCount: changePct(current.customerCount, before.customerCount),
        aov: changePct(current.aov, before.aov),
      },
      period: range,
      previousPeriod: previous,
    };
  }

  private async summarize(
    user: AuthUser,
    scope: { branchId?: string; impossible?: true },
    { fromDate, toDate }: DateRange,
  ) {
    if (scope.impossible) {
      return { revenue: 0, orderCount: 0, customerCount: 0, aov: 0 };
    }
    const rows = await this.prisma.$queryRaw<SummaryRow[]>`
      SELECT COALESCE(SUM(grand_total), 0) AS "revenue",
             COUNT(*)::int                 AS "orderCount",
             COUNT(DISTINCT customer_id)::int AS "customerCount"
      FROM orders
      WHERE tenant_id = ${user.tenantId}
        AND status = ${REVENUE_STATUS}
        AND created_at >= ${fromDate}
        AND created_at <= ${toDate}
        ${scope.branchId ? Prisma.sql`AND branch_id = ${scope.branchId}` : Prisma.empty}
    `;
    const row = rows[0];
    const revenue = Number(row?.revenue ?? 0);
    const orderCount = row?.orderCount ?? 0;
    return {
      revenue,
      orderCount,
      customerCount: row?.customerCount ?? 0,
      aov: averageOrderValue(revenue, orderCount),
    };
  }

  /**
   * Revenue over time, bucketed in the shop's local day or month.
   *
   * `AT TIME ZONE` is the whole point: an order rung up at 23:30 on the 5th belongs to the
   * 5th's takings, and grouping on the raw UTC timestamp would file it under the 6th for
   * every shop in Vietnam. Mongo did this with `$dateToString`'s `timezone` argument.
   */
  async getRevenueSeries(user: AuthUser, query: RevenueSeriesQueryDto) {
    const scope = orderScope(user, query.branchId);
    const { fromDate, toDate } = query.range();
    const groupBy =
      query.groupBy === GroupBy.MONTH ? GroupBy.MONTH : GroupBy.DAY;

    if (scope.impossible) return { groupBy, series: [] };

    const rows = await this.prisma.$queryRaw<BucketRow[]>`
      SELECT to_char(created_at AT TIME ZONE ${TZ_NAME}, ${BUCKET_FORMAT[groupBy]}) AS "bucket",
             COALESCE(SUM(grand_total), 0) AS "revenue",
             COUNT(*)::int                 AS "orderCount"
      FROM orders
      WHERE tenant_id = ${user.tenantId}
        AND status = ${REVENUE_STATUS}
        AND created_at >= ${fromDate}
        AND created_at <= ${toDate}
        ${scope.branchId ? Prisma.sql`AND branch_id = ${scope.branchId}` : Prisma.empty}
      GROUP BY 1
      ORDER BY 1
    `;

    return {
      groupBy,
      series: rows.map((row) => ({
        bucket: row.bucket,
        revenue: Number(row.revenue),
        orderCount: row.orderCount,
      })),
    };
  }

  async getRevenueByPaymentMethod(user: AuthUser, query: StatsQueryDto) {
    const scope = orderScope(user, query.branchId);
    if (scope.impossible) return { breakdown: [] };

    const rows = await this.prisma.order.groupBy({
      by: ['paymentMethod'],
      where: this.orderWhere(user, scope, query.range()),
      _sum: { grandTotal: true },
      _count: { _all: true },
    });

    return {
      breakdown: rows
        .map((row) => ({
          paymentMethod: row.paymentMethod,
          revenue: Number(row._sum.grandTotal ?? 0),
          orderCount: row._count._all,
        }))
        .sort((a, b) => b.revenue - a.revenue),
    };
  }

  /**
   * Revenue attributed to whoever rang the sale up. Two queries rather than the old
   * `$lookup`: group the orders, then name the staff — a join would repeat every user row
   * across all their orders just to read one name back out.
   */
  async getRevenueByStaff(user: AuthUser, query: StatsQueryDto) {
    const scope = orderScope(user, query.branchId);
    if (scope.impossible) return { staff: [] };

    const rows = await this.prisma.order.groupBy({
      by: ['userId'],
      where: this.orderWhere(user, scope, query.range()),
      _sum: { grandTotal: true },
      _count: { _all: true },
    });

    const staff = await this.prisma.user.findMany({
      where: { id: { in: rows.map((row) => row.userId) } },
      select: { id: true, profileFirstName: true, profileLastName: true },
    });
    const nameOf = new Map(staff.map((s) => [s.id, fullName(s)]));

    return {
      staff: rows
        .map((row) => {
          const revenue = Number(row._sum.grandTotal ?? 0);
          const orderCount = row._count._all;
          return {
            userId: row.userId,
            staffName: nameOf.get(row.userId) ?? null,
            revenue,
            orderCount,
            aov: averageOrderValue(revenue, orderCount),
          };
        })
        .sort((a, b) => b.revenue - a.revenue),
    };
  }

  /**
   * Best sellers. Line revenue is `unitPrice × quantity − discountAmount`, so only the
   * discount actually spread onto the line counts — an order-level discount that was never
   * allocated to a line is invisible here, exactly as in the old pipeline.
   */
  async getTopProducts(user: AuthUser, query: TopProductsQueryDto) {
    const scope = orderScope(user, query.branchId);
    const sortBy =
      query.sortBy === TopProductsSort.REVENUE
        ? TopProductsSort.REVENUE
        : TopProductsSort.QUANTITY;

    if (scope.impossible) return { sortBy, products: [] };

    const { fromDate, toDate } = query.range();
    // Not a bind parameter — Postgres will not take one in ORDER BY. Safe because it is one
    // of exactly two literals chosen above, never a value from the query string.
    const orderColumn = Prisma.raw(`"${sortBy}"`);

    const rows = await this.prisma.$queryRaw<
      {
        productItemId: string;
        productName: string | null;
        quantity: Prisma.Decimal;
        revenue: Prisma.Decimal;
      }[]
    >`
      SELECT oi.product_item_id AS "productItemId",
             MIN(oi.product_name) AS "productName",
             COALESCE(SUM(oi.quantity), 0) AS "quantity",
             COALESCE(SUM(oi.unit_price * oi.quantity - oi.discount_amount), 0) AS "revenue"
      FROM order_items oi
      JOIN orders o ON o.id = oi.order_id
      WHERE o.tenant_id = ${user.tenantId}
        AND o.status = ${REVENUE_STATUS}
        AND o.created_at >= ${fromDate}
        AND o.created_at <= ${toDate}
        ${scope.branchId ? Prisma.sql`AND o.branch_id = ${scope.branchId}` : Prisma.empty}
      GROUP BY oi.product_item_id
      ORDER BY ${orderColumn} DESC
      LIMIT ${query.limit}
    `;

    return {
      sortBy,
      products: rows.map((row) => ({
        productItemId: row.productItemId,
        // The old pipeline took `$first`, i.e. whichever line the storage engine handed
        // back first; MIN is the same idea made deterministic. The name is denormalized per
        // line, so it can differ between lines if the product was renamed mid-period.
        productName: row.productName,
        quantity: Number(row.quantity),
        revenue: Number(row.revenue),
      })),
    };
  }

  private orderWhere(
    user: AuthUser,
    scope: { branchId?: string },
    { fromDate, toDate }: DateRange,
  ): Prisma.OrderWhereInput {
    return {
      tenantId: user.tenantId ?? undefined,
      status: REVENUE_STATUS,
      ...(scope.branchId ? { branchId: scope.branchId } : {}),
      createdAt: { gte: fromDate, lte: toDate },
    };
  }

  // ─── Cash flow ─────────────────────────────────────────────────────────────

  /** Income vs expense over the range, optionally narrowed to one money-flow. */
  async getCashflow(user: AuthUser, query: CashflowQueryDto) {
    const rows = await this.prisma.cashFlow.groupBy({
      by: ['flowType'],
      where: this.cashflowWhere(user, query),
      _sum: { amount: true },
      _count: { _all: true },
    });

    const totalOf = (flowType: string) =>
      Number(rows.find((row) => row.flowType === flowType)?._sum.amount ?? 0);
    const income = totalOf(FlowType.INCOME);
    const expense = totalOf(FlowType.EXPENSE);

    return {
      income,
      expense,
      net: income - expense,
      byType: rows.map((row) => ({
        flowType: row.flowType,
        total: Number(row._sum.amount ?? 0),
        count: row._count._all,
      })),
    };
  }

  /** The same rows, one by one, with the names behind each foreign key resolved. */
  async getCashflowList(user: AuthUser, query: CashflowListQueryDto) {
    const where = this.cashflowWhere(user, query);
    const { page, limit } = query;

    const [rows, total] = await Promise.all([
      this.prisma.cashFlow.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: skipFor(page, limit),
        take: limit,
        include: {
          branch: { select: { name: true } },
          warehouse: { select: { name: true } },
          supplier: { select: { supplierName: true } },
          createdBy: {
            select: { profileFirstName: true, profileLastName: true },
          },
        },
      }),
      this.prisma.cashFlow.count({ where }),
    ]);

    const data = rows.map((row) => ({
      id: row.id,
      flowType: row.flowType,
      amount: Number(row.amount),
      paymentMethod: row.paymentMethod,
      description: row.description,
      paymentReference: row.paymentReference,
      branchName: row.branch?.name ?? null,
      warehouseName: row.warehouse?.name ?? null,
      // Flattened for the table, which has one "location" column and does not care which
      // kind it is — but `locationType` is kept so a row can still be traced back.
      locationName: row.branch?.name ?? row.warehouse?.name ?? null,
      locationType: row.branchId
        ? 'branch'
        : row.warehouseId
          ? 'warehouse'
          : null,
      supplierName: row.supplier?.supplierName ?? null,
      createdByName: fullName(row.createdBy),
      orderId: row.orderId,
      createdAt: row.createdAt,
    }));

    return paginate(data, total, page, limit);
  }

  private cashflowWhere(
    user: AuthUser,
    query: CashflowQueryDto,
  ): Prisma.CashFlowWhereInput {
    const scope = locationScope(user, query.branchId, query.warehouseId);
    const { fromDate, toDate } = query.range();
    const paymentMethod = (query as CashflowListQueryDto).paymentMethod;

    return {
      tenantId: user.tenantId ?? undefined,
      ...scope,
      createdAt: { gte: fromDate, lte: toDate },
      ...(query.flowType ? { flowType: query.flowType } : {}),
      ...(paymentMethod ? { paymentMethod } : {}),
      // `flow` picks a money-flow by the prefix its reference code carries — ORD sales, SUP
      // supplier payments, PAYR payroll. The old service matched the anchored regex
      // `/^ORD/i`; `startsWith` with an insensitive mode is that same test, expressed so an
      // index can still serve it.
      ...(query.flow
        ? {
            paymentReference: {
              startsWith: query.flow,
              mode: Prisma.QueryMode.insensitive,
            },
          }
        : {}),
    };
  }

  // ─── Inventory ─────────────────────────────────────────────────────────────

  /**
   * Stock valuation and what is running out, for one location or the whole tenant.
   *
   * `lowStockThreshold` is a flat number from the query string, deliberately not the
   * per-row `Inventory.minStock` the alerting engine uses. They answer different questions:
   * `minStock` is "this item needs reordering", the threshold here is "show me everything
   * under N" — a slider on the dashboard. The old endpoint had only the slider.
   */
  async getInventory(user: AuthUser, query: InventoryStatsQueryDto) {
    const scope = locationScope(user, query.branchId, query.warehouseId);
    const threshold = query.lowStockThreshold ?? DEFAULT_LOW_STOCK_THRESHOLD;
    const tenantId = user.tenantId ?? undefined;

    const branchFilter = scope.branchId
      ? Prisma.sql`AND i.branch_id = ${scope.branchId}`
      : Prisma.empty;
    const warehouseFilter = scope.warehouseId
      ? Prisma.sql`AND i.warehouse_id = ${scope.warehouseId}`
      : Prisma.empty;

    const [totalRows, lowStock] = await Promise.all([
      this.prisma.$queryRaw<
        {
          stockValue: Prisma.Decimal;
          totalUnits: number;
          skuCount: number;
          outOfStock: number;
        }[]
      >`
        SELECT COALESCE(SUM(i.stock * pi.cost_price), 0) AS "stockValue",
               COALESCE(SUM(i.stock), 0)::int            AS "totalUnits",
               COUNT(*)::int                             AS "skuCount",
               COUNT(*) FILTER (WHERE i.stock <= 0)::int AS "outOfStock"
        FROM inventories i
        JOIN product_items pi ON pi.id = i.product_item_id
        WHERE i.tenant_id = ${tenantId}
          ${branchFilter}
          ${warehouseFilter}
      `,
      this.prisma.inventory.findMany({
        where: { tenantId, ...scope, stock: { lte: threshold } },
        orderBy: { stock: 'asc' },
        take: LOW_STOCK_LIST_LIMIT,
        select: {
          productItemId: true,
          branchId: true,
          warehouseId: true,
          stock: true,
          productItem: { select: { productName: true, sku: true } },
        },
      }),
    ]);

    const totals = totalRows[0];
    return {
      stockValue: Number(totals?.stockValue ?? 0),
      totalUnits: totals?.totalUnits ?? 0,
      skuCount: totals?.skuCount ?? 0,
      outOfStock: totals?.outOfStock ?? 0,
      lowStockThreshold: threshold,
      lowStock: lowStock.map((row) => ({
        productItemId: row.productItemId,
        productName: row.productItem.productName,
        sku: row.productItem.sku,
        // Was one polymorphic `locationId`/`locationType` pair in Mongo; two nullable
        // columns here, so the response says which one is set rather than making the client
        // guess. See the schema header on the polymorphic-location conversion.
        branchId: row.branchId,
        warehouseId: row.warehouseId,
        locationType: row.branchId ? 'branch' : 'warehouse',
        stock: row.stock,
      })),
    };
  }
}
