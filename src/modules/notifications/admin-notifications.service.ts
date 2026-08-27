import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { EmailService } from '../../common/email/email.service';
import { SystemRole } from '../../common/constants/system-role';
import { UserStatus } from '../../common/constants/user-status';
import { paginate, skipFor } from '../../common/utils/pagination';
import {
  ANNOUNCEMENT_TYPE,
  AnnouncementTarget,
  SYSTEM_NOTIFICATION_TYPES,
} from './system-notification.constants';
import type {
  ComposeAnnouncementDto,
  ListSystemNotificationsDto,
} from './dto/announcement.dto';

/**
 * The platform operators' own notification console — ported from iKiotMS-BE's
 * `src/modules/system-notification`, seven routes at the old paths.
 *
 * It reads the same `notifications` table as every shop's inbox, and what separates the two
 * is **`tenantId` and `recipientId` both being null**. Every query here carries that pair;
 * see `systemFilter`. `NotificationService.notifySystem()` is the only writer of those rows,
 * so this module is purely the read/acknowledge half of a feed written elsewhere.
 *
 * The one thing it does write is an **announcement**: an operator composing an email to shop
 * owners. That is not a system event — nobody is being notified *of* it — so it is stored
 * with its own type and never appears in the system feed.
 */
@Injectable()
export class AdminNotificationService {
  private readonly logger = new Logger(AdminNotificationService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly email: EmailService,
  ) {}

  // ─── System event feed ─────────────────────────────────────────────────────

  async listSystem(query: ListSystemNotificationsDto) {
    const { page, limit } = query;
    const where = this.systemFilter();

    const [rows, total] = await Promise.all([
      this.prisma.notification.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: skipFor(page, limit),
        take: limit,
      }),
      this.prisma.notification.count({ where }),
    ]);

    return paginate(rows, total, page, limit);
  }

  /**
   * The old handler was `findByIdAndUpdate(id, { isRead: true })` with **no filter at all** —
   * the only one of the five that forgot it. An operator could flip the read flag on any
   * notification in the database, including one addressed to a single employee of one shop,
   * and read its contents back out of the response. The filter is the same one the delete
   * routes already used.
   */
  async markSystemRead(id: string) {
    const { count } = await this.prisma.notification.updateMany({
      where: { id, ...this.systemFilter() },
      data: { isRead: true },
    });
    if (count === 0) throw new NotFoundException('Không tìm thấy thông báo');
    return this.prisma.notification.findUnique({ where: { id } });
  }

  async markAllSystemRead() {
    const { count } = await this.prisma.notification.updateMany({
      where: { ...this.systemFilter(), isRead: false },
      data: { isRead: true },
    });
    return { message: 'Đã đánh dấu tất cả là đã đọc', updated: count };
  }

  async removeSystem(id: string) {
    const { count } = await this.prisma.notification.deleteMany({
      where: { id, ...this.systemFilter() },
    });
    if (count === 0) throw new NotFoundException('Không tìm thấy thông báo');
    return { message: 'Đã xoá thông báo' };
  }

  async removeAllSystem() {
    const { count } = await this.prisma.notification.deleteMany({
      where: this.systemFilter(),
    });
    return { message: 'Đã xoá toàn bộ thông báo hệ thống', deleted: count };
  }

  // ─── Announcements ─────────────────────────────────────────────────────────

  /**
   * Compose one email to many shop owners, and keep a record that it was sent.
   *
   * The send is **fire-and-forget**, as it was before: an operator writing to every shop in
   * the country must not sit on a spinner while a few hundred SMTP round-trips finish, and
   * one bad address must not fail the whole batch. The row is written first, so the record
   * survives even if delivery does not — `EmailService` swallows and logs its own failures.
   *
   * The count in the message is the number of owners with an email on file, not the number
   * of shops targeted: an owner who registered with only a phone number cannot be emailed,
   * and the old code silently dropped them from the tally the same way.
   */
  async compose(actorId: string, dto: ComposeAnnouncementDto) {
    const isSelection = dto.targetType === AnnouncementTarget.SELECTION;
    const targetTenants = isSelection ? (dto.targetTenants ?? []) : [];

    const announcement = await this.prisma.notification.create({
      data: {
        title: dto.title,
        description: dto.description,
        type: ANNOUNCEMENT_TYPE,
        category: dto.category,
        targetType: dto.targetType,
        createdById: actorId,
        isRead: false,
        targetTenants: {
          create: targetTenants.map((tenantId) => ({ tenantId })),
        },
      },
      include: {
        targetTenants: { include: { tenant: { select: { name: true } } } },
      },
    });

    const owners = await this.prisma.user.findMany({
      where: {
        systemRole: SystemRole.TENANT_OWNER,
        status: UserStatus.ACTIVE,
        email: { not: null },
        ...(isSelection ? { tenantId: { in: targetTenants } } : {}),
      },
      select: { email: true },
    });
    const recipients = owners
      .map((owner) => owner.email)
      .filter((email): email is string => Boolean(email));

    for (const to of recipients) {
      void this.email
        .sendSystemNotificationEmail(to, {
          title: dto.title,
          description: dto.description,
          category: dto.category,
        })
        .catch((error: unknown) => {
          this.logger.error(
            `Failed to send announcement email to ${to}`,
            error instanceof Error ? error.stack : error,
          );
        });
    }

    return {
      message: `Thông báo đã được xếp lịch gửi tới ${recipients.length} chủ cửa hàng.`,
      data: announcement,
    };
  }

  /** What has been sent, newest first — the operators' own outbox. */
  async listAnnouncements(query: ListSystemNotificationsDto) {
    const { page, limit } = query;
    const where = { type: ANNOUNCEMENT_TYPE };

    const [rows, total] = await Promise.all([
      this.prisma.notification.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: skipFor(page, limit),
        take: limit,
        include: {
          targetTenants: { include: { tenant: { select: { name: true } } } },
          createdBy: {
            select: {
              email: true,
              profileFirstName: true,
              profileLastName: true,
            },
          },
        },
      }),
      this.prisma.notification.count({ where }),
    ]);

    return paginate(rows, total, page, limit);
  }

  /**
   * What makes a row belong to the operators' console: nobody's tenant, nobody's inbox, and
   * one of the event types this feed was built for.
   */
  private systemFilter() {
    return {
      tenantId: null,
      recipientId: null,
      type: { in: SYSTEM_NOTIFICATION_TYPES },
    };
  }
}
