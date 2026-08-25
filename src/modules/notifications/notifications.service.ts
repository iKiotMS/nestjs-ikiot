import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { UserStatus } from '../../common/constants/user-status';
import { SystemRole } from '../../common/constants/system-role';
import { RealtimeGateway } from '../../common/realtime/realtime.gateway';
import type { AuthUser } from '../../common/types/auth-user.type';
import type { NotificationContent } from './notification-content.type';

export interface NotifyInput extends NotificationContent {
  tenantId: string | null;
  recipientIds: (string | null | undefined)[];
  referenceId?: string;
}

// Ported from iKiotMS-BE's src/services/notificationService.js (fan-out) +
// src/modules/notification (inbox API), merged into one module here. `notify()`,
// `tenantOwners()` and `managersOfLocation()` are ported from the fan-out side so far.
// Port `approversOf`/`displayName` when the modules that need them (leave requests,
// tickets, ...) get their real business logic — and put any new notification *copy* in a
// `templates/*.templates.ts` file, never inline here or in the calling service (see
// CLAUDE.md "Notification & audit templates").
@Injectable()
export class NotificationService {
  private readonly logger = new Logger(NotificationService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly realtime: RealtimeGateway,
  ) {}

  // ─── Fan-out ───────────────────────────────────────────────────────────────

  // Never throws — a notification failing must not break whatever business transaction
  // triggered it, same invariant as iKiotMS-BE's version. Writes the Notification row
  // (source of truth for the inbox/badge count) and emits over the recipient's socket
  // room; FCM push is still deferred (no push service wired into this project yet).
  async notify(input: NotifyInput): Promise<{ notified: number }> {
    try {
      const ids = [
        ...new Set(
          input.recipientIds.filter((id): id is string => Boolean(id)),
        ),
      ];
      if (ids.length === 0) return { notified: 0 };

      // Independent inserts, not wrapped in a transaction on purpose — one recipient's
      // write failing shouldn't roll back a notification the others already received.
      const docs = await Promise.all(
        ids.map((recipientId) =>
          this.prisma.notification.create({
            data: {
              tenantId: input.tenantId,
              recipientId,
              type: input.type,
              title: input.title,
              description: input.description,
              link: input.link,
              referenceId: input.referenceId,
              isRead: false,
            },
          }),
        ),
      );

      for (const doc of docs) {
        this.realtime.emitToRoom(
          `user:${doc.recipientId}`,
          'notification',
          doc,
        );
      }

      return { notified: ids.length };
    } catch (error) {
      this.logger.error(
        `Failed to notify (${input.type})`,
        error instanceof Error ? error.stack : error,
      );
      return { notified: 0 };
    }
  }

  async tenantOwners(tenantId: string): Promise<string[]> {
    try {
      const owners = await this.prisma.user.findMany({
        where: {
          tenantId,
          systemRole: SystemRole.TENANT_OWNER,
          status: UserStatus.ACTIVE,
        },
        select: { id: true },
      });
      return owners.map((o) => o.id);
    } catch (error) {
      this.logger.error(
        'tenantOwners lookup failed',
        error instanceof Error ? error.stack : error,
      );
      return [];
    }
  }

  /**
   * Who to tell about something that happened at one branch or warehouse.
   *
   * iKiotMS-BE answered this by looking for users whose \`role\` was BRANCH_MANAGER or
   * WAREHOUSE_MANAGER *and* who were posted there. Neither role exists any more (see
   * CLAUDE.md "Authorization"), and the appointment now lives on the location itself —
   * so this reads \`Branch.managerId\` / \`Warehouse.managerId\`.
   *
   * Falls back to the tenant's owners when the location has no manager appointed. The old
   * version returned an empty list there, which meant a low-stock warning for an
   * unmanaged branch was silently sent to nobody.
   */
  async managersOfLocation(args: {
    tenantId: string;
    branchId: string | null;
    warehouseId: string | null;
  }): Promise<string[]> {
    try {
      const location = args.branchId
        ? await this.prisma.branch.findFirst({
            where: { id: args.branchId, tenantId: args.tenantId },
            select: { managerId: true },
          })
        : args.warehouseId
          ? await this.prisma.warehouse.findFirst({
              where: { id: args.warehouseId, tenantId: args.tenantId },
              select: { managerId: true },
            })
          : null;

      if (!location?.managerId) return this.tenantOwners(args.tenantId);

      // An appointed manager who has since been suspended shouldn't be the only recipient.
      const manager = await this.prisma.user.findFirst({
        where: { id: location.managerId, status: UserStatus.ACTIVE },
        select: { id: true },
      });
      return manager ? [manager.id] : this.tenantOwners(args.tenantId);
    } catch (error) {
      this.logger.error(
        'managersOfLocation lookup failed',
        error instanceof Error ? error.stack : error,
      );
      return [];
    }
  }

  // ─── Inbox (ported from iKiotMS-BE's NotificationController) ───────────────

  private inboxFilter(user: AuthUser) {
    return {
      tenantId: user.tenantId,
      OR: [{ recipientId: user.userId }, { recipientId: null }],
    };
  }

  async listInbox(user: AuthUser, page: number, limit: number) {
    const where = this.inboxFilter(user);
    const [data, total, unreadCount] = await Promise.all([
      this.prisma.notification.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.notification.count({ where }),
      this.prisma.notification.count({ where: { ...where, isRead: false } }),
    ]);
    return {
      data,
      unreadCount,
      pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
    };
  }

  async unreadCount(user: AuthUser) {
    const count = await this.prisma.notification.count({
      where: { ...this.inboxFilter(user), isRead: false },
    });
    return { count };
  }

  async markAllRead(user: AuthUser) {
    await this.prisma.notification.updateMany({
      where: { ...this.inboxFilter(user), isRead: false },
      data: { isRead: true },
    });
    return { success: true };
  }

  async markRead(user: AuthUser, id: string) {
    const result = await this.prisma.notification.updateMany({
      where: { id, ...this.inboxFilter(user) },
      data: { isRead: true },
    });
    if (result.count === 0)
      throw new NotFoundException('Notification not found');
    return { success: true };
  }

  async deleteAll(user: AuthUser) {
    await this.prisma.notification.deleteMany({
      where: this.inboxFilter(user),
    });
    return { success: true };
  }

  async deleteOne(user: AuthUser, id: string) {
    const result = await this.prisma.notification.deleteMany({
      where: { id, ...this.inboxFilter(user) },
    });
    if (result.count === 0)
      throw new NotFoundException('Notification not found');
    return { success: true };
  }

  async registerDeviceToken(userId: string, token: string, userAgent?: string) {
    // Pull the token off every account that currently holds it first — prevents a token
    // that migrated to a new login from staying registered against the old account too.
    await this.prisma.userFcmToken.deleteMany({ where: { token } });
    await this.prisma.userFcmToken.create({
      data: { userId, token, userAgent },
    });
    return { success: true };
  }

  async removeDeviceToken(userId: string, token: string) {
    await this.prisma.userFcmToken.deleteMany({ where: { userId, token } });
    return { success: true };
  }
}
