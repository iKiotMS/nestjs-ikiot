import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { InventoryService } from '../inventories/inventories.service';
import { NotificationService } from '../notifications/notifications.service';
import { StockMovementNotificationTemplates } from '../notifications/templates/stock-movement.templates';
import { SupplierNotificationTemplates } from '../notifications/templates/supplier.templates';
import { SystemRole } from '../../common/constants/system-role';
import {
  destinationRef,
  sourceRef,
  toLocationColumns,
} from '../../common/dto/location-ref.dto';
import type { LocationRefDto } from '../../common/dto/location-ref.dto';
import { paginate, skipFor } from '../../common/utils/pagination';
import type { AuthUser } from '../../common/types/auth-user.type';
import { supervisesLocation } from '../working-schedules/shift-supervisor.service';
import {
  FINAL_MOVEMENT_STATUSES,
  MovementStatus,
  MovementType,
} from './stock-movement.constants';
import { crossedCreditWarning } from './credit-warning';
import {
  CreateStockMovementDto,
  MovementItemDto,
  QueryStockMovementDto,
  ReceiveMovementDto,
  UpdateMovementDetailsDto,
} from './dto/stock-movement.dto';
import type { Inventory, Prisma } from '../../../generated/prisma/client';

/** The pair of nullable FKs naming one end of a movement. */
interface LocationColumns {
  branchId: string | null;
  warehouseId: string | null;
}

const DETAIL_INCLUDE = {
  details: {
    select: {
      id: true,
      productItemId: true,
      quantity: true,
      importPrice: true,
      receivedQuantity: true,
      note: true,
      productItem: {
        select: { id: true, sku: true, productName: true, productCode: true },
      },
    },
  },
  fromSupplier: { select: { id: true, supplierName: true } },
  fromBranch: { select: { id: true, name: true } },
  fromWarehouse: { select: { id: true, name: true } },
  toBranch: { select: { id: true, name: true } },
  toWarehouse: { select: { id: true, name: true } },
  createdBy: {
    select: {
      id: true,
      phoneNumber: true,
      email: true,
      profileFirstName: true,
      profileLastName: true,
    },
  },
} as const satisfies Prisma.StockMovementRequestInclude;

type MovementRow = Prisma.StockMovementRequestGetPayload<{
  include: typeof DETAIL_INCLUDE;
}>;

/**
 * Real port of iKiotMS-BE's StockMovementService.
 *
 * This is the module that actually moves stock, so two rules run through all of it:
 *
 *   1. **Stock changes and the status change happen in the same transaction.** A shipment
 *      that decremented the source but failed to reach IN_TRANSIT would leave stock that
 *      exists nowhere.
 *   2. **Notifications and low-stock warnings are sent after that transaction commits, and
 *      never throw.** A rolled-back transfer must not leave behind a warning about
 *      something that didn't happen, and a failed notification must not fail the transfer.
 *
 * **Access control is a substitution, not a port.** The old service branched on
 * BRANCH_MANAGER / WAREHOUSE_MANAGER, both of which are gone: a TENANT_OWNER may act at any
 * of the tenant's locations, and a STAFF account may act at the one location they are posted
 * to (`User.branchId` / `User.warehouseId`).
 *
 * The other half of the old rule — `managedScheduleAccess`, temporary rights while running a
 * shift — **is restored** now that WorkingSchedule is ported. It enters through `canActAt()`
 * and nowhere else, exactly as this comment used to promise.
 *
 * Two role-based rules from the old code are deliberately dropped rather than translated:
 * "branch managers cannot create IMPORT requests" and "branch managers cannot EXPORT to a
 * warehouse" — the first is now a matter of who holds `stock_movement:create`, and the
 * second survives as a rule about the movement itself (see `assertTransferMakesSense`).
 */
@Injectable()
export class StockMovementService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly inventory: InventoryService,
    private readonly notifications: NotificationService,
  ) {}

  // ─── Reads ─────────────────────────────────────────────────────────────────

  async findAll(user: AuthUser, query: QueryStockMovementDto) {
    const tenantId = this.tenantOf(user);
    const where: Prisma.StockMovementRequestWhereInput = { tenantId };
    if (query.status) where.status = query.status;
    if (query.movementType) where.movementType = query.movementType;

    // A staff account sees the movements that touch their own location, from either end.
    const own = this.postingOf(user);
    if (own) {
      if (!own.branchId && !own.warehouseId) {
        // Posted nowhere: there is no location whose movements they could be looking at.
        // Matching on the columns directly would quietly match rows where both are null.
        return paginate([], 0, query.page, query.limit);
      }
      where.OR = [
        { fromBranchId: own.branchId, fromWarehouseId: own.warehouseId },
        { toBranchId: own.branchId, toWarehouseId: own.warehouseId },
      ];
    }

    const [rows, total] = await Promise.all([
      this.prisma.stockMovementRequest.findMany({
        where,
        include: DETAIL_INCLUDE,
        orderBy: { createdAt: 'desc' },
        skip: skipFor(query.page, query.limit),
        take: query.limit,
      }),
      this.prisma.stockMovementRequest.count({ where }),
    ]);

    return paginate(
      rows.map((row) => this.toResponse(row)),
      total,
      query.page,
      query.limit,
    );
  }

  async findOne(user: AuthUser, id: string) {
    const request = await this.findRow(this.tenantOf(user), id);
    // Viewable from either end — the sender and the receiver both need to see it.
    if (
      !this.canActAt(user, this.source(request)) &&
      !this.canActAt(user, this.destination(request))
    ) {
      throw new ForbiddenException('Bạn không có quyền xem phiếu này');
    }
    return this.toResponse(request);
  }

  // ─── Create ────────────────────────────────────────────────────────────────

  async create(user: AuthUser, dto: CreateStockMovementDto) {
    const tenantId = this.tenantOf(user);
    this.assertNoDuplicateItems(dto.details);

    const from = this.resolveSource(user, dto);
    const to = dto.toLocation ? this.columnsOf(dto.toLocation) : null;
    await this.assertEndpointsValid(tenantId, dto.movementType, from, to);

    const details = await this.prepareLines(
      tenantId,
      dto.movementType,
      from,
      dto.details,
    );

    const totalPrice =
      dto.movementType === MovementType.ADJUST ? 0 : this.totalOf(details);

    if (dto.movementType === MovementType.IMPORT) {
      await this.assertCreditHeadroom(tenantId, dto.fromSupplierId, totalPrice);
    }

    // IMPORT and ADJUST have nothing to pick and pack, so they open at PENDING.
    const status =
      dto.movementType === MovementType.IMPORT ||
      dto.movementType === MovementType.ADJUST
        ? MovementStatus.PENDING
        : MovementStatus.DRAFT;

    const created = await this.prisma.stockMovementRequest.create({
      data: {
        tenantId,
        movementType: dto.movementType,
        status,
        note: dto.note,
        createdById: user.userId,
        totalPrice,
        fromSupplierId: dto.fromSupplierId,
        fromBranchId: from?.branchId ?? null,
        fromWarehouseId: from?.warehouseId ?? null,
        toBranchId: to?.branchId ?? null,
        toWarehouseId: to?.warehouseId ?? null,
        details: { create: details },
      },
      include: DETAIL_INCLUDE,
    });

    await this.notifyMovement(created, user.userId, {
      ...StockMovementNotificationTemplates.created(
        created.id,
        created.movementType,
      ),
      // An import is awaited by the place receiving it; a transfer is actioned by the
      // place sending it.
      notifyFrom: created.movementType !== MovementType.IMPORT,
      notifyTo: created.movementType === MovementType.IMPORT,
    });

    return this.toResponse(created);
  }

  // ─── State transitions ─────────────────────────────────────────────────────

  /** Replace the lines. Allowed while the request is still being written up. */
  async updateDetails(
    user: AuthUser,
    id: string,
    dto: UpdateMovementDetailsDto,
  ) {
    const tenantId = this.tenantOf(user);
    const request = await this.findRow(tenantId, id);
    this.assertNoDuplicateItems(dto.details);

    const isTransfer =
      request.movementType === MovementType.EXPORT ||
      request.movementType === MovementType.RETURN;

    if (isTransfer) {
      this.assertStatus(request, [MovementStatus.OPENING]);
      // Either end may still correct the list while it is open.
      if (
        !this.canActAt(user, this.source(request)) &&
        !this.canActAt(user, this.destination(request))
      ) {
        throw new ForbiddenException('Bạn không có quyền sửa phiếu này');
      }
    } else {
      this.assertStatus(request, [MovementStatus.PENDING]);
      const end =
        request.movementType === MovementType.IMPORT
          ? this.destination(request)
          : this.source(request);
      this.assertCanActAt(user, end);
    }

    const details = await this.prepareLines(
      tenantId,
      request.movementType,
      this.source(request),
      dto.details,
    );

    const totalPrice =
      request.movementType === MovementType.ADJUST ? 0 : this.totalOf(details);

    if (request.movementType === MovementType.IMPORT) {
      await this.assertCreditHeadroom(
        tenantId,
        request.fromSupplierId,
        totalPrice,
      );
    }

    const updated = await this.prisma.$transaction(async (tx) => {
      await tx.stockMovementRequestItem.deleteMany({
        where: { requestId: id },
      });
      return tx.stockMovementRequest.update({
        where: { id },
        data: { totalPrice, details: { create: details } },
        include: DETAIL_INCLUDE,
      });
    });

    return this.toResponse(updated);
  }

  /** DRAFT → OPENING: the sending location starts picking. */
  async open(user: AuthUser, id: string) {
    const request = await this.findRow(this.tenantOf(user), id);
    this.assertCanActAt(user, this.source(request));
    this.assertStatus(request, [MovementStatus.DRAFT]);
    await this.assertSourceStock(this.prisma, request);

    return this.toResponse(await this.setStatus(id, MovementStatus.OPENING));
  }

  /** OPENING → CLOSED: picking is finished and the list is final. */
  async close(user: AuthUser, id: string) {
    const request = await this.findRow(this.tenantOf(user), id);
    this.assertCanActAt(user, this.source(request));
    this.assertStatus(request, [MovementStatus.OPENING]);
    if (request.details.length === 0) {
      throw new BadRequestException('Không thể chốt phiếu chưa có mặt hàng');
    }
    await this.assertSourceStock(this.prisma, request);

    return this.toResponse(await this.setStatus(id, MovementStatus.CLOSED));
  }

  /**
   * → IN_TRANSIT: the goods physically leave.
   *
   * This is where a transfer's stock actually moves out of the source, so the decrement and
   * the status change share one transaction.
   */
  async ship(user: AuthUser, id: string) {
    const tenantId = this.tenantOf(user);
    const request = await this.findRow(tenantId, id);
    this.assertCanActAt(user, this.source(request));
    this.assertStatus(request, [MovementStatus.CLOSED, MovementStatus.PENDING]);

    const isTransfer =
      request.movementType === MovementType.EXPORT ||
      request.movementType === MovementType.RETURN;

    const { shipped, crossings } = await this.prisma.$transaction(
      async (tx) => {
        const lowStock: (Inventory | null)[] = [];

        if (isTransfer) {
          const from = this.source(request);
          for (const line of request.details) {
            const quantity = Number(line.quantity);
            // `deductStock` is the check as well as the write. The `assertSourceStock`
            // calls on open/close and when the lines are set are advisory — they tell the
            // picker early that the stock isn't there. This is what actually stops two
            // shipments emptying the same shelf twice.
            const after = await this.inventory.deductStock(tx, {
              tenantId,
              productItemId: line.productItemId,
              branchId: from.branchId,
              warehouseId: from.warehouseId,
              quantity,
              label: line.productItem.sku ?? line.productItemId,
            });
            lowStock.push(this.inventory.lowStockCrossing(after, -quantity));
          }
        }

        return {
          shipped: await tx.stockMovementRequest.update({
            where: { id },
            data: { status: MovementStatus.IN_TRANSIT },
            include: DETAIL_INCLUDE,
          }),
          crossings: lowStock,
        };
      },
    );

    await this.inventory.notifyLowStock(crossings);
    await this.notifyMovement(shipped, user.userId, {
      ...StockMovementNotificationTemplates.inTransit(shipped.id),
      notifyTo: true,
    });

    return this.toResponse(shipped);
  }

  /**
   * → RECEIVED: the destination confirms what turned up, line by line.
   *
   * Received quantities are what moves stock, not ordered quantities — a short delivery is
   * normal and the difference is simply never added. For an IMPORT this is also the moment
   * the supplier's debt goes up, so the credit limit is re-checked here and not only at
   * creation time: several imports can be open against the same supplier at once.
   */
  async receive(user: AuthUser, id: string, dto: ReceiveMovementDto) {
    const tenantId = this.tenantOf(user);
    const request = await this.findRow(tenantId, id);
    this.assertCanActAt(user, this.destination(request));

    this.assertStatus(
      request,
      request.movementType === MovementType.IMPORT
        ? [MovementStatus.PENDING, MovementStatus.IN_TRANSIT]
        : [MovementStatus.IN_TRANSIT],
    );

    const receivedByItem = new Map(
      dto.details.map((line) => [line.productItemId, line.receivedQuantity]),
    );
    const missing = request.details.find(
      (line) => !receivedByItem.has(line.productItemId),
    );
    if (missing) {
      throw new BadRequestException(
        `Thiếu số lượng thực nhận cho mặt hàng ${missing.productItem.sku ?? missing.productItemId}`,
      );
    }

    const totalReceived = [...receivedByItem.values()].reduce(
      (sum, quantity) => sum + quantity,
      0,
    );
    if (totalReceived === 0) {
      throw new BadRequestException(
        'Không thể nhận phiếu rỗng: phải có ít nhất một mặt hàng có số lượng thực nhận > 0',
      );
    }

    const to = this.destination(request);
    const { received, creditWarning } = await this.prisma.$transaction(
      async (tx) => {
        let importCost = 0;

        for (const line of request.details) {
          const quantity = receivedByItem.get(line.productItemId) ?? 0;
          await tx.stockMovementRequestItem.update({
            where: { id: line.id },
            data: { receivedQuantity: quantity },
          });

          if (quantity <= 0) continue;
          if (request.movementType === MovementType.IMPORT) {
            importCost += quantity * Number(line.importPrice ?? 0);
          }
          await this.inventory.adjustStock(tx, {
            tenantId,
            productItemId: line.productItemId,
            branchId: to.branchId,
            warehouseId: to.warehouseId,
            delta: quantity,
          });
        }

        const warning =
          request.movementType === MovementType.IMPORT && request.fromSupplierId
            ? await this.chargeSupplier(
                tx,
                tenantId,
                request.fromSupplierId,
                importCost,
                request.details
                  .filter(
                    (line) => (receivedByItem.get(line.productItemId) ?? 0) > 0,
                  )
                  .map((line) => line.productItemId),
              )
            : null;

        return {
          received: await tx.stockMovementRequest.update({
            where: { id },
            data: { status: MovementStatus.RECEIVED },
            include: DETAIL_INCLUDE,
          }),
          creditWarning: warning,
        };
      },
    );

    if (creditWarning) {
      const owners = await this.notifications.tenantOwners(tenantId);
      await this.notifications.notify({
        tenantId,
        recipientIds: owners.filter((ownerId) => ownerId !== user.userId),
        referenceId: request.fromSupplierId ?? undefined,
        ...creditWarning,
      });
    }

    await this.notifyMovement(received, user.userId, {
      ...StockMovementNotificationTemplates.received(received.id),
      notifyCreator: true,
      notifyFrom: true,
    });

    return this.toResponse(received);
  }

  /**
   * ADJUST PENDING → COMPLETED: apply the counted numbers.
   *
   * The stock delta is `counted - recorded`, which is negative for shrinkage. An adjustment
   * that would take a line below zero is refused rather than clamped: a count that implies
   * negative stock means the count is wrong, or something else moved while it was open.
   */
  async approveAdjust(user: AuthUser, id: string) {
    const tenantId = this.tenantOf(user);
    const request = await this.findRow(tenantId, id);
    this.assertCanActAt(user, this.source(request));

    if (request.movementType !== MovementType.ADJUST) {
      throw new BadRequestException(
        'Chỉ phiếu kiểm kê mới duyệt theo cách này',
      );
    }
    this.assertStatus(request, [MovementStatus.PENDING]);

    const from = this.source(request);
    const changes = request.details.map((line) => {
      if (line.receivedQuantity === null) {
        throw new BadRequestException(
          `Thiếu số lượng thực đếm cho mặt hàng ${line.productItem.sku ?? line.productItemId}`,
        );
      }
      return {
        productItemId: line.productItemId,
        label: line.productItem.sku ?? line.productItemId,
        delta: Number(line.receivedQuantity) - Number(line.quantity),
      };
    });

    if (changes.every((change) => change.delta === 0)) {
      throw new BadRequestException(
        'Không có chênh lệch nào: số thực đếm bằng số hệ thống cho mọi mặt hàng',
      );
    }

    const { completed, crossings } = await this.prisma.$transaction(
      async (tx) => {
        const lowStock: (Inventory | null)[] = [];

        for (const change of changes) {
          if (change.delta === 0) continue;

          if (change.delta < 0) {
            const current = await tx.inventory.findFirst({
              where: {
                tenantId,
                productItemId: change.productItemId,
                branchId: from.branchId,
                warehouseId: from.warehouseId,
              },
              select: { stock: true },
            });
            const stock = current?.stock ?? 0;
            if (stock + change.delta < 0) {
              throw new BadRequestException(
                `Điều chỉnh làm tồn kho của ${change.label} xuống dưới 0 (hiện có ${stock}, điều chỉnh ${change.delta})`,
              );
            }
          }

          const after = await this.inventory.adjustStock(tx, {
            tenantId,
            productItemId: change.productItemId,
            branchId: from.branchId,
            warehouseId: from.warehouseId,
            delta: change.delta,
          });
          lowStock.push(this.inventory.lowStockCrossing(after, change.delta));
        }

        return {
          completed: await tx.stockMovementRequest.update({
            where: { id },
            data: { status: MovementStatus.COMPLETED },
            include: DETAIL_INCLUDE,
          }),
          crossings: lowStock,
        };
      },
    );

    await this.inventory.notifyLowStock(crossings);
    return this.toResponse(completed);
  }

  /**
   * Cancel, returning stock that had already left.
   *
   * A transfer cancelled while IN_TRANSIT has already been decremented from the source by
   * `ship`, so it is put back. Anything already RECEIVED or COMPLETED is finished and can
   * only be corrected with a new movement, not by rewriting this one.
   */
  async cancel(user: AuthUser, id: string) {
    const tenantId = this.tenantOf(user);
    const request = await this.findRow(tenantId, id);

    // Either end may call it off.
    if (
      !this.canActAt(user, this.source(request)) &&
      !this.canActAt(user, this.destination(request))
    ) {
      throw new ForbiddenException('Bạn không có quyền hủy phiếu này');
    }
    if (FINAL_MOVEMENT_STATUSES.includes(request.status)) {
      throw new ConflictException(
        `Không thể hủy phiếu đang ở trạng thái ${request.status}`,
      );
    }

    const shouldReturnStock =
      request.status === MovementStatus.IN_TRANSIT &&
      (request.movementType === MovementType.EXPORT ||
        request.movementType === MovementType.RETURN);

    const cancelled = await this.prisma.$transaction(async (tx) => {
      if (shouldReturnStock) {
        const from = this.source(request);
        for (const line of request.details) {
          await this.inventory.adjustStock(tx, {
            tenantId,
            productItemId: line.productItemId,
            branchId: from.branchId,
            warehouseId: from.warehouseId,
            delta: Number(line.quantity),
          });
        }
      }

      return tx.stockMovementRequest.update({
        where: { id },
        data: { status: MovementStatus.CANCELLED },
        include: DETAIL_INCLUDE,
      });
    });

    await this.notifyMovement(cancelled, user.userId, {
      ...StockMovementNotificationTemplates.cancelled(cancelled.id),
      notifyCreator: true,
      notifyFrom: true,
      notifyTo: true,
    });

    return this.toResponse(cancelled);
  }

  // ─── Line preparation ──────────────────────────────────────────────────────

  /**
   * IMPORT lines: a price and a quantity are both required, and the import price may not
   * exceed the variant's retail price — buying above what you sell at is a data-entry
   * error, and it silently poisons every margin report downstream.
   */
  private async prepareImportLines(tenantId: string, lines: MovementItemDto[]) {
    const items = await this.itemsById(tenantId, lines);

    return lines.map((line) => {
      const item = items.get(line.productItemId)!;
      if (!line.quantity || line.quantity <= 0) {
        throw new BadRequestException(
          `Số lượng phải lớn hơn 0 cho mặt hàng ${item.sku ?? item.id}`,
        );
      }
      if (!line.importPrice || line.importPrice <= 0) {
        throw new BadRequestException(
          `Đơn giá nhập phải lớn hơn 0 cho mặt hàng ${item.sku ?? item.id}`,
        );
      }
      if (line.importPrice > Number(item.retailPrice)) {
        throw new BadRequestException(
          `Đơn giá nhập không được lớn hơn giá bán lẻ (${Number(item.retailPrice)}) của mặt hàng ${item.sku ?? item.id}`,
        );
      }
      return {
        productItemId: line.productItemId,
        quantity: line.quantity,
        importPrice: line.importPrice,
        note: line.note,
      };
    });
  }

  /** EXPORT/RETURN lines: price defaults to cost, and the source must hold the stock. */
  private async prepareTransferLines(
    tenantId: string,
    from: LocationColumns,
    lines: MovementItemDto[],
  ) {
    const items = await this.itemsById(tenantId, lines);

    const prepared = lines.map((line) => {
      const item = items.get(line.productItemId)!;
      if (!line.quantity || line.quantity <= 0) {
        throw new BadRequestException(
          `Số lượng phải lớn hơn 0 cho mặt hàng ${item.sku ?? item.id}`,
        );
      }
      return {
        productItemId: line.productItemId,
        quantity: line.quantity,
        importPrice: line.importPrice ?? Number(item.costPrice),
        note: line.note,
      };
    });

    await this.assertStockCovers(this.prisma, tenantId, from, prepared);
    return prepared;
  }

  /**
   * ADJUST lines: `receivedQuantity` is the counted figure and is required; `quantity` is
   * what the system currently thinks and is filled in from inventory when the client
   * doesn't send it, so the recorded difference is against the number at count time.
   */
  private async prepareAdjustLines(
    tenantId: string,
    from: LocationColumns,
    lines: MovementItemDto[],
  ) {
    const items = await this.itemsById(tenantId, lines);
    const stock = await this.prisma.inventory.findMany({
      where: {
        tenantId,
        branchId: from.branchId,
        warehouseId: from.warehouseId,
        productItemId: { in: lines.map((line) => line.productItemId) },
      },
      select: { productItemId: true, stock: true },
    });
    const stockByItem = new Map(
      stock.map((row) => [row.productItemId, row.stock]),
    );

    return lines.map((line) => {
      const item = items.get(line.productItemId)!;
      if (line.receivedQuantity === undefined) {
        throw new BadRequestException(
          `Cần số lượng thực đếm cho mặt hàng ${item.sku ?? item.id}`,
        );
      }
      return {
        productItemId: line.productItemId,
        quantity: line.quantity ?? stockByItem.get(line.productItemId) ?? 0,
        receivedQuantity: line.receivedQuantity,
        note: line.note,
      };
    });
  }

  private async itemsById(tenantId: string, lines: MovementItemDto[]) {
    const ids = [...new Set(lines.map((line) => line.productItemId))];
    const items = await this.prisma.productItem.findMany({
      where: { tenantId, id: { in: ids } },
      select: { id: true, sku: true, retailPrice: true, costPrice: true },
    });
    if (items.length !== ids.length) {
      throw new NotFoundException('Không tìm thấy mặt hàng');
    }
    return new Map(items.map((item) => [item.id, item]));
  }

  // ─── Guards ────────────────────────────────────────────────────────────────

  private assertNoDuplicateItems(lines: MovementItemDto[]): void {
    const ids = lines.map((line) => line.productItemId);
    if (new Set(ids).size !== ids.length) {
      throw new BadRequestException(
        'Một mặt hàng chỉ được xuất hiện một lần trong phiếu',
      );
    }
  }

  private assertStatus(request: MovementRow, allowed: readonly string[]): void {
    if (!allowed.includes(request.status)) {
      throw new ConflictException(
        `Thao tác này chỉ hợp lệ khi phiếu ở trạng thái ${allowed.join(' hoặc ')} (hiện tại: ${request.status})`,
      );
    }
  }

  /**
   * Which fields a movement type needs, in one place — every branch of the state machine
   * downstream assumes these hold.
   */
  private async assertEndpointsValid(
    tenantId: string,
    movementType: string,
    from: LocationColumns | null,
    to: LocationColumns | null,
  ): Promise<void> {
    if (movementType === MovementType.IMPORT) {
      if (!to)
        throw new BadRequestException('Phiếu nhập phải có địa điểm nhận');
    } else {
      if (!from) throw new BadRequestException('Phiếu phải có địa điểm xuất');
      if (movementType === MovementType.ADJUST) {
        // A stocktake happens at one place; a destination would be meaningless.
        if (to) {
          throw new BadRequestException('Phiếu kiểm kê không có địa điểm nhận');
        }
      } else {
        if (!to) throw new BadRequestException('Phiếu phải có địa điểm nhận');
        this.assertTransferMakesSense(movementType, from, to);
      }
    }

    await this.inventory.assertLocationsExist(
      tenantId,
      [from, to].filter(
        (columns): columns is LocationColumns => columns !== null,
      ),
    );
  }

  /**
   * Builds the lines for whichever movement type this is. `from` is only ever null for an
   * IMPORT, which is the one type whose lines don't depend on a source location.
   */
  private async prepareLines(
    tenantId: string,
    movementType: string,
    from: LocationColumns | null,
    lines: MovementItemDto[],
  ) {
    if (movementType === MovementType.IMPORT) {
      return this.prepareImportLines(tenantId, lines);
    }
    if (!from) throw new BadRequestException('Phiếu phải có địa điểm xuất');
    return movementType === MovementType.ADJUST
      ? this.prepareAdjustLines(tenantId, from, lines)
      : this.prepareTransferLines(tenantId, from, lines);
  }

  /**
   * A transfer must actually go somewhere else, and stock moving from a branch back to a
   * warehouse is a RETURN, not an EXPORT.
   *
   * iKiotMS-BE expressed the second rule as "branch managers cannot EXPORT to a warehouse".
   * It was never really about who was asking — the direction is what makes it a return —
   * so it survives the loss of that role as a rule about the movement.
   */
  private assertTransferMakesSense(
    movementType: string,
    from: LocationColumns,
    to: LocationColumns,
  ): void {
    if (from.branchId === to.branchId && from.warehouseId === to.warehouseId) {
      throw new BadRequestException(
        'Địa điểm xuất và địa điểm nhận không được trùng nhau',
      );
    }
    if (
      movementType === MovementType.EXPORT &&
      from.branchId &&
      to.warehouseId
    ) {
      throw new BadRequestException(
        'Chuyển hàng từ chi nhánh về kho phải dùng loại phiếu RETURN thay vì EXPORT',
      );
    }
  }

  /** The source must hold every quantity on the request as it stands. */
  private async assertSourceStock(
    client: Prisma.TransactionClient | PrismaService,
    request: MovementRow,
  ): Promise<void> {
    if (
      request.movementType !== MovementType.EXPORT &&
      request.movementType !== MovementType.RETURN
    ) {
      return;
    }
    await this.assertStockCovers(
      client,
      request.tenantId,
      this.source(request),
      request.details.map((line) => ({
        productItemId: line.productItemId,
        quantity: Number(line.quantity),
      })),
    );
  }

  private async assertStockCovers(
    client: Prisma.TransactionClient | PrismaService,
    tenantId: string,
    from: LocationColumns,
    lines: { productItemId: string; quantity: number }[],
  ): Promise<void> {
    if (lines.length === 0) return;

    const rows = await client.inventory.findMany({
      where: {
        tenantId,
        branchId: from.branchId,
        warehouseId: from.warehouseId,
        productItemId: { in: lines.map((line) => line.productItemId) },
      },
      select: { productItemId: true, stock: true },
    });
    const stockByItem = new Map(
      rows.map((row) => [row.productItemId, row.stock]),
    );

    for (const line of lines) {
      const available = stockByItem.get(line.productItemId) ?? 0;
      if (line.quantity > available) {
        throw new BadRequestException(
          `Số lượng ${line.quantity} vượt quá tồn kho hiện có (${available}) tại địa điểm xuất`,
        );
      }
    }
  }

  /**
   * Refuses an import that would push the supplier past their credit limit. A limit of 0
   * means no limit, matching how the field is seeded.
   */
  private async assertCreditHeadroom(
    tenantId: string,
    supplierId: string | null | undefined,
    amount: number,
  ): Promise<void> {
    if (!supplierId) {
      throw new BadRequestException('Phiếu nhập phải có nhà cung cấp');
    }
    const supplier = await this.prisma.supplier.findFirst({
      where: { id: supplierId, tenantId },
      select: { creditLimit: true, outstandingDebt: true },
    });
    if (!supplier) throw new NotFoundException('Không tìm thấy nhà cung cấp');

    const limit = Number(supplier.creditLimit);
    if (limit <= 0) return;

    const projected = Number(supplier.outstandingDebt) + amount;
    if (projected > limit) {
      throw new BadRequestException(
        `Vượt hạn mức công nợ. Nợ hiện tại: ${Number(supplier.outstandingDebt)}, phiếu này: ${amount}, hạn mức: ${limit}`,
      );
    }
  }

  /**
   * Books the received goods against the supplier: debt up, and the variants recorded as
   * things this supplier sells us.
   *
   * The limit is re-checked *after* the increment and throws to roll the whole receipt
   * back, because several imports can be open against one supplier at once and only the
   * receipts that actually land count. Returns the warning to send once the transaction
   * commits, or null.
   */
  private async chargeSupplier(
    tx: Prisma.TransactionClient,
    tenantId: string,
    supplierId: string,
    amount: number,
    receivedItemIds: string[],
  ) {
    if (receivedItemIds.length > 0) {
      // Idempotent: receiving twice from the same supplier must not fail on the join row.
      await tx.productItemSupplier.createMany({
        data: receivedItemIds.map((productItemId) => ({
          productItemId,
          supplierId,
        })),
        skipDuplicates: true,
      });
    }
    if (amount <= 0) return null;

    const supplier = await tx.supplier.update({
      where: { id: supplierId },
      data: { outstandingDebt: { increment: amount } },
      select: {
        supplierName: true,
        creditLimit: true,
        outstandingDebt: true,
        tenantId: true,
      },
    });
    if (supplier.tenantId !== tenantId) {
      throw new NotFoundException('Không tìm thấy nhà cung cấp');
    }

    const limit = Number(supplier.creditLimit);
    if (limit <= 0) return null;

    const debt = Number(supplier.outstandingDebt);
    if (debt > limit) {
      throw new BadRequestException(
        `Vượt hạn mức công nợ khi nhận hàng. Nợ mới: ${debt}, hạn mức: ${limit}`,
      );
    }

    return crossedCreditWarning(debt, amount, limit)
      ? SupplierNotificationTemplates.creditLimitWarning(
          supplier.supplierName,
          debt,
          limit,
        )
      : null;
  }

  // ─── Access ────────────────────────────────────────────────────────────────

  private tenantOf(user: AuthUser): string {
    if (!user.tenantId) {
      throw new ForbiddenException('Tài khoản không thuộc cửa hàng nào');
    }
    return user.tenantId;
  }

  /**
   * The one location a staff account may act at, or `null` for an account that may act
   * anywhere in the tenant.
   *
   * This is the seam where WorkingSchedule's temporary access will plug in when that module
   * is ported — see the class comment.
   */
  private postingOf(user: AuthUser): LocationColumns | null {
    if (
      user.systemRole === SystemRole.TENANT_OWNER ||
      user.systemRole === SystemRole.ADMIN
    ) {
      return null;
    }
    return { branchId: user.branchId, warehouseId: user.warehouseId };
  }

  /**
   * The one seam, as promised: a TENANT_OWNER acts anywhere in the tenant, a STAFF account
   * acts where it is posted — **or where the shift it is currently supervising reaches**.
   *
   * That last clause is `managedScheduleAccess` from iKiotMS-BE, restored now that
   * WorkingSchedule is ported. It only ever widens to a location the supervisor is already
   * posted at (`ShiftSupervisorService` intersects the shift's locations with their own),
   * so this is about *when* they may act, not *where*.
   */
  private canActAt(user: AuthUser, location: LocationColumns): boolean {
    const own = this.postingOf(user);
    if (!own) return true;
    if (supervisesLocation(user.shiftSupervision, location)) return true;
    if (location.branchId) return own.branchId === location.branchId;
    if (location.warehouseId) return own.warehouseId === location.warehouseId;
    return false;
  }

  private assertCanActAt(user: AuthUser, location: LocationColumns): void {
    if (!this.canActAt(user, location)) {
      throw new ForbiddenException(
        'Bạn chỉ thao tác được với phiếu tại nơi làm việc của mình',
      );
    }
  }

  /**
   * Where the movement takes stock from. A staff account that omitted it gets their own
   * posting; a TENANT_OWNER has to name one, since they have no single location.
   */
  private resolveSource(
    user: AuthUser,
    dto: CreateStockMovementDto,
  ): LocationColumns | null {
    if (dto.movementType === MovementType.IMPORT) return null;
    if (dto.fromLocation) {
      const columns = this.columnsOf(dto.fromLocation);
      this.assertCanActAt(user, columns);
      return columns;
    }

    const own = this.postingOf(user);
    if (!own || (!own.branchId && !own.warehouseId)) {
      throw new BadRequestException(
        'Phiếu phải có địa điểm xuất (fromLocation)',
      );
    }
    return own;
  }

  private columnsOf(ref: LocationRefDto): LocationColumns {
    return toLocationColumns(ref);
  }

  private source(request: MovementRow): LocationColumns {
    return {
      branchId: request.fromBranchId,
      warehouseId: request.fromWarehouseId,
    };
  }

  private destination(request: MovementRow): LocationColumns {
    return {
      branchId: request.toBranchId,
      warehouseId: request.toWarehouseId,
    };
  }

  // ─── Plumbing ──────────────────────────────────────────────────────────────

  private async findRow(tenantId: string, id: string): Promise<MovementRow> {
    const request = await this.prisma.stockMovementRequest.findFirst({
      where: { id, tenantId },
      include: DETAIL_INCLUDE,
    });
    if (!request)
      throw new NotFoundException('Không tìm thấy phiếu chuyển kho');
    return request;
  }

  private setStatus(id: string, status: string) {
    return this.prisma.stockMovementRequest.update({
      where: { id },
      data: { status },
      include: DETAIL_INCLUDE,
    });
  }

  private totalOf(lines: { quantity: number; importPrice?: number }[]): number {
    return lines.reduce(
      (sum, line) => sum + line.quantity * (line.importPrice ?? 0),
      0,
    );
  }

  /**
   * Tells the people who need to know, after the work is done.
   *
   * The person who performed the action is always removed from the list — nobody needs to
   * be told about the thing they just did. `notify()` de-duplicates, so someone who is both
   * the creator and the receiving manager still gets one message.
   */
  private async notifyMovement(
    request: MovementRow,
    actorId: string,
    options: {
      type: string;
      title: string;
      description: string;
      link?: string;
      notifyCreator?: boolean;
      notifyFrom?: boolean;
      notifyTo?: boolean;
    },
  ): Promise<void> {
    const { notifyCreator, notifyFrom, notifyTo, ...content } = options;
    const tenantId = request.tenantId;

    const recipients: string[] = [];
    if (notifyCreator) recipients.push(request.createdById);
    if (notifyFrom) {
      recipients.push(
        ...(await this.notifications.managersOfLocation({
          tenantId,
          ...this.source(request),
        })),
      );
    }
    if (notifyTo) {
      recipients.push(
        ...(await this.notifications.managersOfLocation({
          tenantId,
          ...this.destination(request),
        })),
      );
    }

    await this.notifications.notify({
      tenantId,
      recipientIds: recipients.filter((id) => id !== actorId),
      referenceId: request.id,
      ...content,
    });
  }

  /** Decimals become numbers, and the two location pairs become the API's ref objects. */
  private toResponse(request: MovementRow) {
    const {
      fromBranchId,
      fromWarehouseId,
      toBranchId,
      toWarehouseId,
      fromBranch,
      fromWarehouse,
      toBranch,
      toWarehouse,
      totalPrice,
      details,
      ...rest
    } = request;

    return {
      ...rest,
      totalPrice: Number(totalPrice),
      fromLocation: sourceRef({ fromBranchId, fromWarehouseId }),
      fromLocationName: (fromBranch ?? fromWarehouse)?.name ?? null,
      toLocation: destinationRef({ toBranchId, toWarehouseId }),
      toLocationName: (toBranch ?? toWarehouse)?.name ?? null,
      details: details.map((line) => ({
        ...line,
        quantity: Number(line.quantity),
        importPrice:
          line.importPrice === null ? null : Number(line.importPrice),
        receivedQuantity:
          line.receivedQuantity === null ? null : Number(line.receivedQuantity),
      })),
    };
  }
}
