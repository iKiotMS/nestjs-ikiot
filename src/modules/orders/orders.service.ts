import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { InventoryService } from '../inventories/inventories.service';
import { NotificationService } from '../notifications/notifications.service';
import { OrderNotificationTemplates } from '../notifications/templates/order.templates';
import { RealtimeGateway } from '../../common/realtime/realtime.gateway';
import { PaymentMethod } from '../../common/constants/payment-method';
import { can } from '../../common/utils/permission';
import type { AuthUser } from '../../common/types/auth-user.type';
import { paginate, skipFor } from '../../common/utils/pagination';
import { SepayOrderService } from './sepay-order.service';
import { PromotionService } from '../promotions/promotions.service';
import {
  INSTANT_COMPLETE_METHODS,
  OrderStatus,
  VALID_ORDER_TRANSITIONS,
} from './order.constants';
import {
  CreateOrderDto,
  PayOfflineOrderDto,
  QueryOrderDto,
} from './dto/order.dto';
import type { Inventory, Prisma } from '../../../generated/prisma/client';

/** The one customer every tenant gets for free, for sales with nobody attached. */
const WALK_IN_CUSTOMER_CODE = 'KH_VANGLAI';
const WALK_IN_CUSTOMER_NAME = 'Khách vãng lai';

const ORDER_INCLUDE = {
  customer: { select: { id: true, name: true, phone: true } },
  branch: { select: { id: true, name: true } },
  user: {
    select: {
      id: true,
      phoneNumber: true,
      profileFirstName: true,
      profileLastName: true,
    },
  },
  items: {
    include: {
      productItem: { select: { id: true, sku: true, productName: true } },
    },
  },
  appliedPromotions: true,
} as const satisfies Prisma.OrderInclude;

type OrderRow = Prisma.OrderGetPayload<{ include: typeof ORDER_INCLUDE }>;

/**
 * Real port of iKiotMS-BE's OrderService.
 *
 * Selling is the one flow where money and stock move at the same time, so the shape of
 * every method here is the same: work out the numbers, do the writes in **one
 * transaction**, and only then send anything to a human.
 *
 * **The order total is computed, never accepted.** iKiotMS-BE took `grandTotal` from the
 * request body and stored it, which meant a crafted call could ring up a full basket for
 * zero. It is derived from the lines here — CLAUDE.md has flagged this since the generated
 * CRUD went in, and this is the port that closes it.
 *
 * **So is the discount.** The client names the promotions it picked; `priceOrder` runs them
 * through the same engine `/promotions/calculate` uses and writes the result. Half-trusting
 * the client — taking the promotion total from it while computing everything else — is how
 * an order could quietly come out at full price with a discount on the screen.
 */
@Injectable()
export class OrderService {
  private readonly logger = new Logger(OrderService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly inventory: InventoryService,
    private readonly notifications: NotificationService,
    private readonly realtime: RealtimeGateway,
    private readonly sepay: SepayOrderService,
    private readonly promotions: PromotionService,
  ) {}

  // ─── Create ────────────────────────────────────────────────────────────────

  async create(tenantId: string, userId: string, dto: CreateOrderDto) {
    const branch = await this.prisma.branch.findFirst({
      where: { id: dto.branchId, tenantId },
      select: { id: true },
    });
    if (!branch) throw new NotFoundException('Không tìm thấy chi nhánh');

    if (dto.customerId)
      await this.assertCustomerExists(tenantId, dto.customerId);
    const isSepay = dto.paymentMethod === PaymentMethod.SEPAY;
    const banking = isSepay ? await this.requireBanking(tenantId) : null;

    const priced = await this.priceOrder(tenantId, dto);
    const { lines, appliedPromotions, discountType, discountValue } = priced;
    const grandTotal = this.grandTotalOf(lines, discountType, discountValue);

    // Cash tendered has to at least cover the bill — the old DTO checked this and it is
    // the difference between "change" and a silent shortfall booked as revenue.
    if (dto.customerPay !== undefined && dto.customerPay < grandTotal) {
      throw new BadRequestException(
        `Khách đưa ${dto.customerPay} nhỏ hơn số phải trả ${grandTotal}`,
      );
    }
    const change =
      dto.customerPay === undefined
        ? null
        : Math.max(0, dto.customerPay - grandTotal);

    const status = INSTANT_COMPLETE_METHODS.includes(dto.paymentMethod)
      ? OrderStatus.COMPLETED
      : OrderStatus.PENDING;
    const paymentReference = this.sepay.generateOrderReference();

    const { order, crossings } = await this.prisma.$transaction(async (tx) => {
      // Resolved inside the transaction: a walk-in row created for an order that then
      // fails would otherwise be left behind.
      const customerId =
        dto.customerId ?? (await this.resolveWalkInCustomer(tx, tenantId));

      const created = await tx.order.create({
        data: {
          tenantId,
          branchId: dto.branchId,
          customerId,
          userId,
          status,
          paymentMethod: dto.paymentMethod,
          paymentReference,
          grandTotal,
          customerPay: dto.customerPay,
          change,
          note: dto.note,
          discountType,
          discountValue,
          items: {
            create: lines.map((line) => ({
              productItemId: line.productItemId,
              productName: line.productName,
              quantity: line.quantity,
              unitPrice: line.unitPrice,
              discountAmount: line.discountAmount,
            })),
          },
          appliedPromotions: { create: appliedPromotions },
        },
        include: ORDER_INCLUDE,
      });

      // Selling takes stock off the shelf, so it watches the low-stock threshold exactly
      // like a transfer does — one rule, in InventoryService. `deductStock` is also what
      // enforces "is there enough": checking first and decrementing after would let two
      // simultaneous sales of the last item both go through.
      const lowStock: (Inventory | null)[] = [];
      for (const line of lines) {
        const after = await this.inventory.deductStock(tx, {
          tenantId,
          productItemId: line.productItemId,
          branchId: dto.branchId,
          warehouseId: null,
          quantity: line.quantity,
          label: line.sku ?? line.productItemId,
        });
        lowStock.push(this.inventory.lowStockCrossing(after, -line.quantity));
      }

      if (status === OrderStatus.COMPLETED) {
        await this.writeSaleCashFlows(tx, created, dto.paymentMethod, userId);
      }

      return { order: created, crossings: lowStock };
    });

    await this.inventory.notifyLowStock(crossings);

    return {
      order: this.toResponse(order),
      qrUrl:
        isSepay && banking
          ? this.sepay.buildQrUrl(banking, grandTotal, paymentReference)
          : null,
    };
  }

  // ─── Reads ─────────────────────────────────────────────────────────────────

  async findAll(user: AuthUser, tenantId: string, query: QueryOrderDto) {
    const where: Prisma.OrderWhereInput = {
      tenantId,
      ...this.branchScope(user),
    };
    if (query.status) where.status = query.status;
    if (query.paymentMethod) where.paymentMethod = query.paymentMethod;
    if (query.branchId) where.branchId = query.branchId;

    // A named customer wins over a free-text search — the old service did the same, and
    // asking for both means the id is the specific thing.
    if (query.customerId) {
      where.customerId = query.customerId;
    } else if (query.search) {
      where.customer = {
        OR: [
          { name: { contains: query.search, mode: 'insensitive' } },
          { phone: { contains: query.search, mode: 'insensitive' } },
        ],
      };
    }

    if (query.fromDate || query.toDate) {
      where.createdAt = {
        ...(query.fromDate ? { gte: new Date(query.fromDate) } : {}),
        ...(query.toDate ? { lte: new Date(query.toDate) } : {}),
      };
    }

    const [rows, total] = await Promise.all([
      this.prisma.order.findMany({
        where,
        include: ORDER_INCLUDE,
        orderBy: { createdAt: 'desc' },
        skip: skipFor(query.page, query.limit),
        take: query.limit,
      }),
      this.prisma.order.count({ where }),
    ]);

    return paginate(
      rows.map((row) => this.toResponse(row)),
      total,
      query.page,
      query.limit,
    );
  }

  async findOne(user: AuthUser, tenantId: string, id: string) {
    const order = await this.findRow(tenantId, id);
    const scope = this.branchScope(user);
    if (scope.branchId !== undefined && order.branchId !== scope.branchId) {
      throw new ForbiddenException(
        'Đơn hàng này không thuộc chi nhánh của bạn',
      );
    }
    return this.toResponse(order);
  }

  /**
   * Which branches this account may see sales from.
   *
   * iKiotMS-BE didn't scope this at all — a cashier at one branch could read every sale in
   * the tenant. `orders:view_all` has sat in the permission catalog the whole time, used by
   * nothing, which reads as the rule that was intended and never wired up: **your own
   * branch by default, everything if you hold `orders:view_all`** (owners and admins always
   * do). Same shape `stock-movements` already uses; the two sit next to each other in the
   * UI and behaving differently would be its own bug report.
   */
  private branchScope(user: AuthUser): { branchId?: string } {
    if (can(user, 'orders', 'view_all')) return {};
    if (!user.branchId) {
      // Not posted anywhere, and no view_all: no branch's sales are theirs to read.
      throw new ForbiddenException(
        'Tài khoản chưa được phân về chi nhánh nào để xem đơn hàng',
      );
    }
    return { branchId: user.branchId };
  }

  // ─── Status ────────────────────────────────────────────────────────────────

  /**
   * Moves an order along its lifecycle, putting stock and money where the new state says
   * they should be.
   *
   * Cancelling or returning gives the stock back. Completing books the revenue; returning
   * books the refund against the same order. The status write is conditional on the status
   * we read, so two tills pressing the button at once can't both apply their side effects.
   */
  async updateStatus(tenantId: string, id: string, newStatus: string) {
    const order = await this.findRow(tenantId, id);

    const allowed = VALID_ORDER_TRANSITIONS[order.status] ?? [];
    if (!allowed.includes(newStatus)) {
      throw new ConflictException(
        `Không thể chuyển đơn hàng từ ${order.status} sang ${newStatus}`,
      );
    }

    const updated = await this.prisma.$transaction(async (tx) => {
      const claimed = await tx.order.updateMany({
        where: { id, status: order.status },
        data: { status: newStatus },
      });
      if (claimed.count === 0) {
        throw new ConflictException(
          'Trạng thái đơn hàng vừa thay đổi, vui lòng tải lại',
        );
      }

      // No low-stock watch here on purpose: cancelling and returning only put stock
      // back, and a level going up can't cross the threshold downwards.
      if (
        newStatus === OrderStatus.CANCELLED ||
        newStatus === OrderStatus.RETURNED
      ) {
        for (const line of order.items) {
          await this.inventory.adjustStock(tx, {
            tenantId,
            productItemId: line.productItemId,
            branchId: order.branchId,
            warehouseId: null,
            delta: Number(line.quantity),
          });
        }
      }

      if (newStatus === OrderStatus.COMPLETED) {
        await this.writeSaleCashFlows(
          tx,
          order,
          order.paymentMethod,
          order.userId,
        );
      }

      if (newStatus === OrderStatus.RETURNED) {
        await tx.cashFlow.create({
          data: {
            tenantId,
            branchId: order.branchId,
            orderId: order.id,
            createdById: order.userId,
            flowType: 'EXPENSE',
            amount: order.grandTotal,
            paymentMethod: order.paymentMethod,
            paymentReference: order.paymentReference,
            description: `Trả hàng đơn ${order.paymentReference}`,
          },
        });
      }

      return tx.order.findUniqueOrThrow({
        where: { id },
        include: ORDER_INCLUDE,
      });
    });

    return this.toResponse(updated);
  }

  /**
   * Settles a SePay order the customer ended up paying another way — the transfer failed,
   * or they pulled out cash instead.
   *
   * Conditional on the order still being PENDING and still SEPAY, so this can't race the
   * webhook into charging twice.
   */
  async payOffline(
    tenantId: string,
    id: string,
    userId: string,
    dto: PayOfflineOrderDto,
  ) {
    const order = await this.findRow(tenantId, id);
    if (
      order.status !== OrderStatus.PENDING ||
      order.paymentMethod !== PaymentMethod.SEPAY
    ) {
      throw new ConflictException(
        'Đơn hàng không còn ở trạng thái chờ thanh toán SePay',
      );
    }

    const grandTotal = Number(order.grandTotal);
    const customerPay = dto.customerPay ?? grandTotal;
    if (customerPay < grandTotal) {
      throw new BadRequestException(
        `Khách đưa ${customerPay} nhỏ hơn số phải trả ${grandTotal}`,
      );
    }
    const paymentMethod = dto.paymentMethod ?? PaymentMethod.CASH;

    const updated = await this.prisma.$transaction(async (tx) => {
      const claimed = await tx.order.updateMany({
        where: {
          id,
          status: OrderStatus.PENDING,
          paymentMethod: PaymentMethod.SEPAY,
        },
        data: {
          status: OrderStatus.COMPLETED,
          paymentMethod,
          customerPay,
          change: Math.max(0, customerPay - grandTotal),
          ...(dto.note ? { note: dto.note } : {}),
        },
      });
      if (claimed.count === 0) {
        throw new ConflictException(
          'Đơn hàng vừa được thanh toán hoặc đã bị hủy, vui lòng tải lại',
        );
      }

      const settled = await tx.order.findUniqueOrThrow({
        where: { id },
        include: ORDER_INCLUDE,
      });
      await this.writeSaleCashFlows(tx, settled, paymentMethod, userId);
      return settled;
    });

    this.announcePaid(updated, grandTotal, paymentMethod);
    return this.toResponse(updated);
  }

  /**
   * The SePay webhook's side of a transfer landing.
   *
   * Returns `null` — rather than throwing — when there is nothing to settle, so the
   * controller can answer SePay 200 and stop it retrying. An already-settled order is
   * logged loudly instead: money arrived for something that was paid another way, and
   * somebody has to refund it by hand.
   */
  async completeSepayOrder(
    tenantId: string,
    paymentReference: string,
    sepayTransactionId: string | null,
    transferAmount: number,
  ) {
    const pending = await this.prisma.order.findFirst({
      where: {
        tenantId,
        paymentReference,
        status: OrderStatus.PENDING,
        paymentMethod: PaymentMethod.SEPAY,
      },
      select: { id: true, grandTotal: true },
    });

    if (!pending) {
      const settled = await this.prisma.order.findFirst({
        where: { tenantId, paymentReference },
        select: { id: true, status: true, paymentMethod: true },
      });
      if (settled) {
        this.logger.warn(
          `SePay transfer ${sepayTransactionId ?? '(no id)'} (${transferAmount}) for ${paymentReference} ignored — ` +
            `order ${settled.id} is already ${settled.status} via ${settled.paymentMethod}. Manual refund may be required.`,
        );
      }
      return null;
    }

    const grandTotal = Number(pending.grandTotal);
    if (transferAmount < grandTotal) {
      throw new BadRequestException(
        `Chuyển thiếu: cần ${grandTotal}, nhận được ${transferAmount}`,
      );
    }

    const updated = await this.prisma.$transaction(async (tx) => {
      const claimed = await tx.order.updateMany({
        where: { id: pending.id, status: OrderStatus.PENDING },
        data: { status: OrderStatus.COMPLETED, sepayTransactionId },
      });
      if (claimed.count === 0) return null;

      const settled = await tx.order.findUniqueOrThrow({
        where: { id: pending.id },
        include: ORDER_INCLUDE,
      });
      await tx.cashFlow.create({
        data: {
          tenantId: settled.tenantId,
          branchId: settled.branchId,
          orderId: settled.id,
          createdById: settled.userId,
          flowType: 'INCOME',
          amount: transferAmount,
          paymentMethod: PaymentMethod.SEPAY,
          paymentReference: settled.paymentReference,
          // Stored on both rows, as iKiotMS-BE did: the order answers "was this paid",
          // the cash flow is what a reconciliation against the bank statement reads.
          sepayTransactionId,
          description: `SePay - ${settled.paymentReference}`,
        },
      });
      return settled;
    });

    if (!updated) return null;

    this.announcePaid(updated, transferAmount, PaymentMethod.SEPAY);

    // Worth a real notification, unlike the rest of the order flow: the confirmation
    // arrives minutes later and the cashier is no longer watching that screen.
    const managers = await this.notifications.managersOfLocation({
      tenantId: updated.tenantId,
      branchId: updated.branchId,
      warehouseId: null,
    });
    await this.notifications.notify({
      tenantId: updated.tenantId,
      recipientIds: [updated.userId, ...managers],
      referenceId: updated.id,
      ...OrderNotificationTemplates.paid(
        updated.paymentReference ?? '',
        transferAmount,
      ),
    });

    return this.toResponse(updated);
  }

  // ─── Internals ─────────────────────────────────────────────────────────────

  private async assertCustomerExists(tenantId: string, customerId: string) {
    const customer = await this.prisma.customer.findFirst({
      where: { id: customerId, tenantId, isDeleted: false },
      select: { id: true },
    });
    if (!customer) throw new NotFoundException('Không tìm thấy khách hàng');
  }

  /**
   * A promotion recorded on an order has to be one of this tenant's.
   *
   * `OrderAppliedPromotion.promotionId` is a real foreign key here, so another tenant's id
   * would satisfy the database and quietly link two tenants' rows together. In Mongo the
   * same field was a dangling reference and nothing noticed.
   */
  /**
   * Everything about the sale's money, worked out here rather than taken on trust: what
   * each line costs after discount, which promotions applied and for how much.
   *
   * **The promotion discount is priced server-side.** It used to be assumed: `grandTotalOf`
   * skips `discountValue` for a PROMOTION sale on the grounds that the engine had already
   * spread it across `items[].discountAmount` — true only if the client had called
   * `/promotions/calculate` and echoed the breakdown back. A till that sent
   * `appliedPromotions` with a total but left the lines alone got a full-price order and no
   * error, so the customer paid the undiscounted amount while the screen showed the
   * discount. Now the client only names the promotion ids and this runs the same engine
   * `/promotions/calculate` does, so the two cannot disagree.
   *
   * It also closes a second hole: the engine re-checks eligibility (dates, branch, minimum
   * spend, usage caps), so an expired or out-of-branch promotion is a 400 instead of a
   * discount. The old code only checked that the id existed in the tenant.
   *
   * The variants get looked up twice on a promotion sale — once here, once inside the
   * engine's cart builder. That is the price of the engine owning its own view of the cart,
   * and one extra indexed read per discounted sale is worth paying for it.
   */
  private async priceOrder(tenantId: string, dto: CreateOrderDto) {
    const lines = await this.priceLines(tenantId, dto);
    const promotionIds = [
      ...new Set((dto.appliedPromotions ?? []).map((p) => p.promotionId)),
    ];

    if (promotionIds.length === 0) {
      if (dto.discountType === 'ORDER' && !dto.discountValue) {
        throw new BadRequestException(
          'Giảm giá cả đơn cần discountValue lớn hơn 0',
        );
      }
      return {
        lines,
        appliedPromotions: [],
        discountType: dto.discountType ?? null,
        discountValue: dto.discountValue ?? 0,
      };
    }

    // One discountType per order, so the two kinds of discount can't be stacked — the
    // schema has nowhere to record that a total is part manual and part promotion.
    if (dto.discountType === 'ORDER') {
      throw new BadRequestException(
        'Không thể vừa giảm giá cả đơn vừa áp dụng khuyến mãi trên cùng một đơn hàng',
      );
    }

    const pricing = await this.promotions.calculate(tenantId, {
      branchId: dto.branchId,
      customerId: dto.customerId,
      items: lines.map((line) => ({
        productItemId: line.productItemId,
        quantity: line.quantity,
        unitPrice: line.unitPrice,
      })),
      promotionIds,
    });

    const discountByItem = new Map(
      pricing.itemBreakdown.map((entry) => [
        entry.productItemId,
        entry.discountAmount,
      ]),
    );

    return {
      // The engine's allocation replaces whatever the client sent, including a manual line
      // discount — see OrderItemDto. Two discounts on one line have no home in the schema.
      lines: lines.map((line) => ({
        ...line,
        discountAmount: discountByItem.get(line.productItemId) ?? 0,
      })),
      appliedPromotions: pricing.appliedPromotions,
      discountType: 'PROMOTION',
      discountValue: pricing.totalDiscount,
    };
  }

  /**
   * A sale with nobody attached still needs a customer row to hang off, so each tenant gets
   * one walk-in record, created the first time it is needed.
   *
   * An `upsert`, not find-then-create: two anonymous sales at once would otherwise both
   * find nothing and both insert. `@@unique([tenantId, customerCode])` is what makes the
   * upsert possible — and is the same index that stops two customers sharing a code.
   */
  private async resolveWalkInCustomer(
    tx: Prisma.TransactionClient,
    tenantId: string,
  ): Promise<string> {
    const customer = await tx.customer.upsert({
      where: {
        tenantId_customerCode: {
          tenantId,
          customerCode: WALK_IN_CUSTOMER_CODE,
        },
      },
      create: {
        tenantId,
        customerCode: WALK_IN_CUSTOMER_CODE,
        name: WALK_IN_CUSTOMER_NAME,
        gender: 'OTHER',
        isDeleted: false,
      },
      update: {},
      select: { id: true },
    });
    return customer.id;
  }

  /** SePay can't be offered without somewhere for the money to land. */
  private async requireBanking(tenantId: string) {
    const tenant = await this.prisma.tenant.findUnique({
      where: { id: tenantId },
      select: {
        bankingBankName: true,
        bankingAccountNumber: true,
        bankingAccountName: true,
      },
    });
    if (!tenant?.bankingAccountNumber || !tenant.bankingBankName) {
      throw new BadRequestException(
        'Cửa hàng chưa cấu hình thông tin ngân hàng để nhận thanh toán SePay',
      );
    }
    return tenant;
  }

  /** Resolves each line's variant and fills in the product name for the receipt. */
  private async priceLines(tenantId: string, dto: CreateOrderDto) {
    const ids = [...new Set(dto.items.map((item) => item.productItemId))];
    const variants = await this.prisma.productItem.findMany({
      where: { tenantId, id: { in: ids } },
      select: { id: true, sku: true, productName: true },
    });
    if (variants.length !== ids.length) {
      throw new NotFoundException('Không tìm thấy mặt hàng trong đơn');
    }
    const byId = new Map(variants.map((v) => [v.id, v]));

    return dto.items.map((item) => ({
      productItemId: item.productItemId,
      productName: byId.get(item.productItemId)!.productName,
      sku: byId.get(item.productItemId)!.sku,
      quantity: item.quantity,
      unitPrice: item.unitPrice,
      discountAmount: item.discountAmount ?? 0,
    }));
  }

  /**
   * What the customer actually owes.
   *
   * Line totals minus the per-line discounts, then minus a manual whole-order discount if
   * there was one. A `PROMOTION` discount is **not** subtracted again: `priceOrder` has
   * already spread it across the lines, and `discountValue` is only carried as a record of
   * the total. That used to be an assumption about what the client had sent; it is now a
   * fact about what this service just computed. Never below zero.
   */
  private grandTotalOf(
    lines: { quantity: number; unitPrice: number; discountAmount: number }[],
    discountType: string | null,
    discountValue: number,
  ): number {
    // Each line is rounded before the discount comes off, exactly as `pricing-engine.ts`
    // rounds `lineTotal`. Summing unrounded and rounding once at the end would leave a
    // promotion sale a đồng or two away from the total the preview screen quoted, which
    // reads as a bug at the till whichever number is "right".
    const afterLineDiscounts = lines.reduce(
      (sum, line) =>
        sum +
        Math.max(
          0,
          Math.round(line.quantity * line.unitPrice) - line.discountAmount,
        ),
      0,
    );
    const orderDiscount = discountType === 'ORDER' ? discountValue : 0;
    return Math.max(0, Math.round(afterLineDiscounts - orderDiscount));
  }

  /**
   * The money rows for a completed sale.
   *
   * A cash sale with change is two rows, not one: the drawer really did take the full note
   * and really did hand some back, and a till count at closing has to reconcile against
   * both. **Only the income row carries `orderId`** — that is what `@@unique([orderId,
   * flowType])` needs to stay satisfied when the same order is later RETURNED and writes
   * its own EXPENSE row. iKiotMS-BE left the change row unlinked too.
   */
  private async writeSaleCashFlows(
    tx: Prisma.TransactionClient,
    order: {
      id: string;
      tenantId: string;
      branchId: string;
      grandTotal: Prisma.Decimal;
      customerPay: Prisma.Decimal | null;
      change: Prisma.Decimal | null;
      paymentReference: string | null;
    },
    paymentMethod: string,
    createdById: string,
  ) {
    const change = Number(order.change ?? 0);
    const givesChange =
      paymentMethod === PaymentMethod.CASH &&
      change > 0 &&
      order.customerPay !== null;

    await tx.cashFlow.create({
      data: {
        tenantId: order.tenantId,
        branchId: order.branchId,
        orderId: order.id,
        createdById,
        flowType: 'INCOME',
        amount: givesChange ? order.customerPay! : order.grandTotal,
        paymentMethod,
        paymentReference: order.paymentReference,
        description: `Đơn hàng ${order.paymentReference}`,
      },
    });

    if (givesChange) {
      await tx.cashFlow.create({
        data: {
          tenantId: order.tenantId,
          branchId: order.branchId,
          createdById,
          flowType: 'EXPENSE',
          amount: change,
          paymentMethod,
          paymentReference: order.paymentReference,
          description: `Tiền thối cho đơn ${order.paymentReference}`,
        },
      });
    }
  }

  /**
   * Tells the shop floor an order just got paid.
   *
   * iKiotMS-BE emitted to an `order:<id>` room that clients joined themselves. That
   * mechanism is gone — the realtime gateway only ever puts a socket in rooms the server
   * chose, which was a deliberate security fix (see CLAUDE.md "Realtime") — so this goes to
   * the tenant room with the order id in the payload for the client to match on.
   */
  private announcePaid(
    order: { id: string; tenantId: string; status: string },
    paidAmount: number,
    paymentMethod: string,
  ) {
    this.realtime.emitToRoom(`tenant:${order.tenantId}`, 'order:paid', {
      orderId: order.id,
      status: order.status,
      paidAmount,
      paymentMethod,
    });
  }

  private async findRow(tenantId: string, id: string): Promise<OrderRow> {
    const order = await this.prisma.order.findFirst({
      where: { id, tenantId },
      include: ORDER_INCLUDE,
    });
    if (!order) throw new NotFoundException('Không tìm thấy đơn hàng');
    return order;
  }

  /** Decimals become numbers — the till does arithmetic on them. */
  private toResponse(order: OrderRow) {
    const { grandTotal, customerPay, change, discountValue, items, ...rest } =
      order;
    return {
      ...rest,
      grandTotal: Number(grandTotal),
      customerPay: customerPay === null ? null : Number(customerPay),
      change: change === null ? null : Number(change),
      discountValue: Number(discountValue),
      items: items.map((item) => ({
        ...item,
        quantity: Number(item.quantity),
        unitPrice: Number(item.unitPrice),
        discountAmount: Number(item.discountAmount),
      })),
      appliedPromotions: order.appliedPromotions.map((promotion) => ({
        ...promotion,
        discountAmount:
          promotion.discountAmount === null
            ? null
            : Number(promotion.discountAmount),
      })),
    };
  }
}
