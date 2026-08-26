import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { SystemRole } from '../../common/constants/system-role';
import { paginate, skipFor } from '../../common/utils/pagination';
import type { AuthUser } from '../../common/types/auth-user.type';
import { ApplicableRuleType, PromotionStatus } from './promotion.constants';
import {
  buildCandidateList,
  resolveSelectedPromotions,
} from './pricing-engine';
import type {
  CartContext,
  CartItem,
  PricingPromotion,
  PricingResult,
} from './pricing-engine';
import {
  CreatePromotionDto,
  PriceCartDto,
  QueryPromotionDto,
  UpdatePromotionDto,
} from './dto/promotion.dto';
import type { Prisma } from '../../../generated/prisma/client';

const PROMOTION_INCLUDE = {
  branches: { select: { branchId: true } },
  ruleCategories: { select: { categoryId: true } },
  ruleProductItems: { select: { productItemId: true } },
} as const satisfies Prisma.PromotionInclude;

type PromotionRow = Prisma.PromotionGetPayload<{
  include: typeof PROMOTION_INCLUDE;
}>;

/**
 * Real port of iKiotMS-BE's PromotionService.
 *
 * The arithmetic lives in `pricing-engine.ts` and never touches the database. This service
 * is the half that does: it fetches the candidates, resolves each cart line's category,
 * counts what a customer has already used, and — for `/apply` — commits the result.
 *
 * **Branch scoping is a substitution.** The old service branched on BRANCH_MANAGER/STAFF
 * to decide who sees which promotions. Those roles are gone, so the rule is now: a
 * TENANT_OWNER sees everything, and a STAFF account sees tenant-wide promotions plus the
 * ones scoped to the branch they are posted at. The old "a branch manager may only ever
 * create promotions for their own branch" rule goes with the role — creating one is
 * `promotions:create`, which a tenant grants deliberately.
 */
@Injectable()
export class PromotionService {
  constructor(private readonly prisma: PrismaService) {}

  // ─── CRUD ──────────────────────────────────────────────────────────────────

  async create(tenantId: string, dto: CreatePromotionDto) {
    this.assertDateOrder(dto.startDate, dto.endDate);
    this.assertCapOnlyForPercent(dto.discountType, dto.maxDiscountAmount);
    await this.assertBranchesExist(tenantId, dto.branchIds ?? []);
    await this.assertRuleTargetsExist(tenantId, dto.applicableRule);

    const created = await this.prisma.promotion.create({
      data: {
        tenantId,
        promoName: dto.promoName,
        description: dto.description,
        discountType: dto.discountType,
        discountValue: dto.discountValue,
        maxDiscountAmount: dto.maxDiscountAmount,
        minOrderValue: dto.minOrderValue ?? 0,
        applicableRuleType: dto.applicableRule.type,
        startDate: new Date(dto.startDate),
        endDate: new Date(dto.endDate),
        stackable: dto.stackable ?? false,
        usageLimit: dto.usageLimit,
        usageLimitPerCustomer: dto.usageLimitPerCustomer,
        usedCount: 0,
        status: PromotionStatus.ACTIVE,
        branches: {
          create: (dto.branchIds ?? []).map((branchId) => ({ branchId })),
        },
        ruleCategories: {
          create: (dto.applicableRule.categoryIds ?? []).map((categoryId) => ({
            categoryId,
          })),
        },
        ruleProductItems: {
          create: (dto.applicableRule.productItemIds ?? []).map(
            (productItemId) => ({ productItemId }),
          ),
        },
      },
      include: PROMOTION_INCLUDE,
    });

    return this.toResponse(created);
  }

  async findAll(user: AuthUser, tenantId: string, query: QueryPromotionDto) {
    const where: Prisma.PromotionWhereInput = {
      tenantId,
      ...this.branchScope(user, query.branchId),
    };
    if (query.status) where.status = query.status;
    if (query.search) {
      where.promoName = { contains: query.search, mode: 'insensitive' };
    }

    const [rows, total] = await Promise.all([
      this.prisma.promotion.findMany({
        where,
        include: PROMOTION_INCLUDE,
        orderBy: { createdAt: 'desc' },
        skip: skipFor(query.page, query.limit),
        take: query.limit,
      }),
      this.prisma.promotion.count({ where }),
    ]);

    return paginate(
      rows.map((row) => this.toResponse(row)),
      total,
      query.page,
      query.limit,
    );
  }

  async findOne(user: AuthUser, tenantId: string, id: string) {
    const promotion = await this.findRow(tenantId, id);
    this.assertBranchAccess(user, promotion);
    return this.toResponse(promotion);
  }

  async update(
    user: AuthUser,
    tenantId: string,
    id: string,
    dto: UpdatePromotionDto,
  ) {
    const existing = await this.findRow(tenantId, id);
    this.assertBranchAccess(user, existing);

    // The conditional rules read sibling fields, so they are re-checked against the
    // merged result rather than against the request on its own.
    const discountType = dto.discountType ?? existing.discountType;
    const maxDiscountAmount =
      dto.maxDiscountAmount ??
      (existing.maxDiscountAmount === null
        ? undefined
        : Number(existing.maxDiscountAmount));
    this.assertCapOnlyForPercent(discountType, maxDiscountAmount);
    this.assertDateOrder(
      dto.startDate ?? existing.startDate,
      dto.endDate ?? existing.endDate,
    );
    if (dto.branchIds) await this.assertBranchesExist(tenantId, dto.branchIds);
    if (dto.applicableRule) {
      await this.assertRuleTargetsExist(tenantId, dto.applicableRule);
    }

    const updated = await this.prisma.$transaction(async (tx) => {
      if (dto.branchIds) {
        await tx.promotionBranch.deleteMany({ where: { promotionId: id } });
        await tx.promotionBranch.createMany({
          data: dto.branchIds.map((branchId) => ({
            promotionId: id,
            branchId,
          })),
        });
      }
      if (dto.applicableRule) {
        await tx.promotionCategory.deleteMany({ where: { promotionId: id } });
        await tx.promotionProductItem.deleteMany({
          where: { promotionId: id },
        });
        await tx.promotionCategory.createMany({
          data: (dto.applicableRule.categoryIds ?? []).map((categoryId) => ({
            promotionId: id,
            categoryId,
          })),
        });
        await tx.promotionProductItem.createMany({
          data: (dto.applicableRule.productItemIds ?? []).map(
            (productItemId) => ({ promotionId: id, productItemId }),
          ),
        });
      }

      return tx.promotion.update({
        where: { id },
        data: {
          promoName: dto.promoName,
          description: dto.description,
          discountType: dto.discountType,
          discountValue: dto.discountValue,
          maxDiscountAmount: dto.maxDiscountAmount,
          minOrderValue: dto.minOrderValue,
          applicableRuleType: dto.applicableRule?.type,
          startDate: dto.startDate ? new Date(dto.startDate) : undefined,
          endDate: dto.endDate ? new Date(dto.endDate) : undefined,
          stackable: dto.stackable,
          usageLimit: dto.usageLimit,
          usageLimitPerCustomer: dto.usageLimitPerCustomer,
          status: dto.status,
          // usedCount is deliberately not writable — see UpdatePromotionDto.
        },
        include: PROMOTION_INCLUDE,
      });
    });

    return this.toResponse(updated);
  }

  /**
   * Soft delete: status becomes INACTIVE. A promotion can't be removed — order rows and
   * promotion logs point at it, and a discount that was genuinely given has to stay
   * explainable months later.
   */
  async deactivate(user: AuthUser, tenantId: string, id: string) {
    const existing = await this.findRow(tenantId, id);
    this.assertBranchAccess(user, existing);

    const updated = await this.prisma.promotion.update({
      where: { id },
      data: { status: PromotionStatus.INACTIVE },
      include: PROMOTION_INCLUDE,
    });
    return this.toResponse(updated);
  }

  async findLogs(
    user: AuthUser,
    tenantId: string,
    id: string,
    query: QueryPromotionDto,
  ) {
    const promotion = await this.findRow(tenantId, id);
    this.assertBranchAccess(user, promotion);

    const where: Prisma.PromotionLogWhereInput = { tenantId, promotionId: id };
    const [rows, total] = await Promise.all([
      this.prisma.promotionLog.findMany({
        where,
        include: {
          order: { select: { id: true, paymentReference: true } },
          customer: { select: { id: true, name: true, phone: true } },
          branch: { select: { id: true, name: true } },
        },
        orderBy: { createdAt: 'desc' },
        skip: skipFor(query.page, query.limit),
        take: query.limit,
      }),
      this.prisma.promotionLog.count({ where }),
    ]);

    const data = rows.map(({ discountAmount, ...log }) => ({
      ...log,
      discountAmount: Number(discountAmount),
      paymentReference: log.order?.paymentReference ?? null,
    }));

    return paginate(data, total, query.page, query.limit);
  }

  // ─── Pricing ───────────────────────────────────────────────────────────────

  /**
   * Every promotion that could apply to this cart, split into branch-specific and
   * tenant-wide, each with eligibility and a standalone preview. Powers the picker.
   */
  async listCandidates(tenantId: string, dto: PriceCartDto) {
    const { cart, candidates, usage } = await this.resolveCart(tenantId, dto);
    const entries = buildCandidateList(candidates, cart, new Date(), usage);

    const shape = (entry: (typeof entries)[number]) => ({
      id: entry.promotion.id,
      promoName: entry.promotion.promoName,
      description: entry.promotion.description,
      discountType: entry.promotion.discountType,
      discountValue: entry.promotion.discountValue,
      maxDiscountAmount: entry.promotion.maxDiscountAmount,
      minOrderValue: entry.promotion.minOrderValue,
      branchIds: entry.promotion.branchIds,
      stackable: entry.promotion.stackable,
      eligible: entry.eligible,
      reason: entry.reason,
      previewDiscount: entry.previewDiscount,
    });

    // Usable ones first, biggest saving first within each group — the order a cashier
    // scans the list in.
    const byUsefulness = (a: (typeof entries)[number], b: typeof a) =>
      a.eligible !== b.eligible
        ? a.eligible
          ? -1
          : 1
        : b.previewDiscount - a.previewDiscount;

    return {
      branchPromotions: entries
        .filter((entry) => entry.promotion.branchIds.length > 0)
        .sort(byUsefulness)
        .map(shape),
      systemPromotions: entries
        .filter((entry) => entry.promotion.branchIds.length === 0)
        .sort(byUsefulness)
        .map(shape),
    };
  }

  /** Read-only preview: no log, no usedCount change, nothing persisted. */
  async calculate(tenantId: string, dto: PriceCartDto): Promise<PricingResult> {
    const { cart, candidates, usage } = await this.resolveCart(tenantId, dto);
    return resolveSelectedPromotions(
      candidates,
      dto.promotionIds ?? [],
      cart,
      new Date(),
      usage,
    );
  }

  /**
   * Commits the discount against an order: bumps `usedCount` and writes one PromotionLog
   * per applied promotion.
   *
   * Both usage caps are re-checked **inside** the transaction. The counts read a moment
   * ago can be stale — two tills, or one customer with two tabs, can both pass the
   * preview and only one of them should win. The global cap is enforced by a conditional
   * update that only increments while there is room; the per-customer cap by re-counting
   * the logs, with `@@unique([orderId, promotionId])` as the backstop against the same
   * order being committed twice.
   */
  async apply(
    tenantId: string,
    userId: string,
    dto: PriceCartDto,
  ): Promise<PricingResult> {
    if (!dto.orderId) {
      throw new BadRequestException('Cần orderId để áp dụng khuyến mãi');
    }

    const { cart, candidates, usage } = await this.resolveCart(tenantId, dto);
    const result = resolveSelectedPromotions(
      candidates,
      dto.promotionIds ?? [],
      cart,
      new Date(),
      usage,
    );
    if (result.appliedPromotions.length === 0) return result;

    const byId = new Map(candidates.map((p) => [p.id, p]));

    await this.prisma.$transaction(async (tx) => {
      for (const applied of result.appliedPromotions) {
        const claimed = await tx.promotion.updateMany({
          where: {
            id: applied.promotionId,
            tenantId,
            OR: [
              { usageLimit: null },
              { usedCount: { lt: this.prisma.promotion.fields.usageLimit } },
            ],
          },
          data: { usedCount: { increment: 1 } },
        });
        if (claimed.count === 0) {
          throw new BadRequestException(
            `Khuyến mãi "${applied.promoName}" đã hết lượt sử dụng`,
          );
        }

        // Always present: the ids came out of `candidates` in the first place.
        const cap = byId.get(applied.promotionId)!.usageLimitPerCustomer;
        if (cap !== null && cart.customerId) {
          const used = await tx.promotionLog.count({
            where: {
              tenantId,
              promotionId: applied.promotionId,
              customerId: cart.customerId,
            },
          });
          if (used >= cap) {
            throw new BadRequestException(
              `Khách hàng đã hết lượt sử dụng khuyến mãi "${applied.promoName}"`,
            );
          }
        }

        await tx.promotionLog.create({
          data: {
            tenantId,
            promotionId: applied.promotionId,
            orderId: dto.orderId,
            branchId: cart.branchId,
            customerId: cart.customerId,
            discountAmount: applied.discountAmount,
            createdById: userId,
            description: `Áp dụng khuyến mãi "${applied.promoName}" cho đơn hàng`,
          },
        });
      }
    });

    return result;
  }

  // ─── Internals ─────────────────────────────────────────────────────────────

  /**
   * Everything the pricing engine needs, in one place: the cart with each line's category
   * resolved, the promotions that could apply, and this customer's usage counts.
   */
  private async resolveCart(tenantId: string, dto: PriceCartDto) {
    const cart = await this.buildCartContext(tenantId, dto);
    const candidates = await this.findCandidates(tenantId, cart.branchId);
    const usage = await this.customerUsageCounts(
      tenantId,
      cart.customerId,
      candidates,
    );
    return { cart, candidates, usage };
  }

  /**
   * A promotion can target a category, but a cart line names a variant — and a variant
   * doesn't carry the category, its parent product does. One query resolves the whole hop.
   */
  private async buildCartContext(
    tenantId: string,
    dto: PriceCartDto,
  ): Promise<CartContext> {
    const ids = [...new Set(dto.items.map((item) => item.productItemId))];
    const variants = await this.prisma.productItem.findMany({
      where: { tenantId, id: { in: ids } },
      select: { id: true, product: { select: { categoryId: true } } },
    });
    if (variants.length !== ids.length) {
      throw new NotFoundException('Không tìm thấy mặt hàng trong giỏ hàng');
    }
    const categoryByItem = new Map(
      variants.map((v) => [v.id, v.product.categoryId]),
    );

    const items: CartItem[] = dto.items.map((item) => ({
      productItemId: item.productItemId,
      categoryId: categoryByItem.get(item.productItemId) ?? null,
      quantity: item.quantity,
      unitPrice: item.unitPrice,
      lineTotal: Math.round(item.quantity * item.unitPrice),
    }));

    return {
      branchId: dto.branchId ?? null,
      customerId: dto.customerId ?? null,
      subtotal: items.reduce((sum, item) => sum + item.lineTotal, 0),
      items,
    };
  }

  /** Live promotions for this tenant — tenant-wide ones plus this branch's. */
  private async findCandidates(
    tenantId: string,
    branchId: string | null,
  ): Promise<PricingPromotion[]> {
    const now = new Date();
    const rows = await this.prisma.promotion.findMany({
      where: {
        tenantId,
        status: PromotionStatus.ACTIVE,
        startDate: { lte: now },
        endDate: { gte: now },
        OR: [
          { branches: { none: {} } },
          ...(branchId ? [{ branches: { some: { branchId } } }] : []),
        ],
      },
      include: PROMOTION_INCLUDE,
    });
    return rows.map((row) => this.toPricingPromotion(row));
  }

  /**
   * How many times this customer has already used each capped promotion. Only the capped
   * ones are counted — the engine stays database-free, so this is handed in as a map.
   */
  private async customerUsageCounts(
    tenantId: string,
    customerId: string | null,
    candidates: PricingPromotion[],
  ): Promise<Record<string, number>> {
    const capped = candidates
      .filter((p) => p.usageLimitPerCustomer !== null)
      .map((p) => p.id);
    if (!customerId || capped.length === 0) return {};

    const rows = await this.prisma.promotionLog.groupBy({
      by: ['promotionId'],
      where: { tenantId, customerId, promotionId: { in: capped } },
      _count: { _all: true },
    });

    return Object.fromEntries(
      rows.map((row) => [row.promotionId, row._count._all]),
    );
  }

  private async findRow(tenantId: string, id: string): Promise<PromotionRow> {
    const promotion = await this.prisma.promotion.findFirst({
      where: { id, tenantId },
      include: PROMOTION_INCLUDE,
    });
    if (!promotion) throw new NotFoundException('Không tìm thấy khuyến mãi');
    return promotion;
  }

  // ─── Guards ────────────────────────────────────────────────────────────────

  private assertDateOrder(start: Date | string, end: Date | string): void {
    if (new Date(end) <= new Date(start)) {
      throw new BadRequestException('Ngày kết thúc phải sau ngày bắt đầu');
    }
  }

  /** A ceiling on a fixed amount is just a smaller fixed amount — reject the confusion. */
  private assertCapOnlyForPercent(discountType: string, cap?: number): void {
    if (cap !== undefined && discountType !== 'PERCENT') {
      throw new BadRequestException(
        'maxDiscountAmount chỉ dùng được khi giảm theo phần trăm',
      );
    }
  }

  private async assertBranchesExist(tenantId: string, branchIds: string[]) {
    const unique = [...new Set(branchIds)];
    if (unique.length === 0) return;
    const found = await this.prisma.branch.count({
      where: { tenantId, id: { in: unique } },
    });
    if (found !== unique.length) {
      throw new NotFoundException('Không tìm thấy chi nhánh');
    }
  }

  /** Whatever the rule points at has to exist in this tenant. */
  private async assertRuleTargetsExist(
    tenantId: string,
    rule: { type: string; categoryIds?: string[]; productItemIds?: string[] },
  ) {
    if (rule.type === ApplicableRuleType.CATEGORY) {
      const unique = [...new Set(rule.categoryIds ?? [])];
      const found = await this.prisma.category.count({
        where: { tenantId, id: { in: unique } },
      });
      if (found !== unique.length) {
        throw new NotFoundException('Không tìm thấy danh mục');
      }
    }
    if (rule.type === ApplicableRuleType.PRODUCT) {
      const unique = [...new Set(rule.productItemIds ?? [])];
      const found = await this.prisma.productItem.count({
        where: { tenantId, id: { in: unique } },
      });
      if (found !== unique.length) {
        throw new NotFoundException('Không tìm thấy mặt hàng');
      }
    }
  }

  /** The list-level half of branch scoping — see the class comment. */
  private branchScope(
    user: AuthUser,
    requestedBranchId?: string,
  ): Prisma.PromotionWhereInput {
    if (this.seesEveryBranch(user)) {
      return requestedBranchId
        ? { branches: { some: { branchId: requestedBranchId } } }
        : {};
    }
    return {
      OR: [
        { branches: { none: {} } },
        ...(user.branchId
          ? [{ branches: { some: { branchId: user.branchId } } }]
          : []),
      ],
    };
  }

  /** The single-row counterpart, for endpoints that fetch by id. */
  private assertBranchAccess(user: AuthUser, promotion: PromotionRow): void {
    if (this.seesEveryBranch(user)) return;
    if (promotion.branches.length === 0) return; // tenant-wide
    const inScope = promotion.branches.some(
      (link) => link.branchId === user.branchId,
    );
    if (!inScope) {
      throw new ForbiddenException(
        'Khuyến mãi này không áp dụng cho chi nhánh của bạn',
      );
    }
  }

  private seesEveryBranch(user: AuthUser): boolean {
    return (
      user.systemRole === SystemRole.TENANT_OWNER ||
      user.systemRole === SystemRole.ADMIN
    );
  }

  // ─── Shapes ────────────────────────────────────────────────────────────────

  /** Prisma row → the plain shape the pricing engine understands. */
  private toPricingPromotion(row: PromotionRow): PricingPromotion {
    return {
      id: row.id,
      promoName: row.promoName,
      description: row.description,
      status: row.status,
      startDate: row.startDate,
      endDate: row.endDate,
      discountType: row.discountType,
      discountValue: Number(row.discountValue),
      maxDiscountAmount:
        row.maxDiscountAmount === null ? null : Number(row.maxDiscountAmount),
      minOrderValue: Number(row.minOrderValue),
      stackable: row.stackable,
      usageLimit: row.usageLimit,
      usageLimitPerCustomer: row.usageLimitPerCustomer,
      usedCount: row.usedCount,
      branchIds: row.branches.map((link) => link.branchId),
      applicableRuleType: row.applicableRuleType,
      ruleCategoryIds: row.ruleCategories.map((link) => link.categoryId),
      ruleProductItemIds: row.ruleProductItems.map(
        (link) => link.productItemId,
      ),
    };
  }

  /** Decimals become numbers, and the join rows become the nested shape the API had. */
  private toResponse(row: PromotionRow) {
    const {
      branches,
      ruleCategories,
      ruleProductItems,
      discountValue,
      maxDiscountAmount,
      minOrderValue,
      applicableRuleType,
      ...rest
    } = row;

    return {
      ...rest,
      discountValue: Number(discountValue),
      maxDiscountAmount:
        maxDiscountAmount === null ? null : Number(maxDiscountAmount),
      minOrderValue: Number(minOrderValue),
      branchIds: branches.map((link) => link.branchId),
      applicableRule: {
        type: applicableRuleType,
        categoryIds: ruleCategories.map((link) => link.categoryId),
        productItemIds: ruleProductItems.map((link) => link.productItemId),
      },
    };
  }
}
