import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '../../prisma/prisma.service';
import { NotificationService } from '../notifications/notifications.service';
import { LeaveRequestNotificationTemplates } from '../notifications/templates/leave-request.templates';
import { LeaveRequestStatus } from './leave-request.constants';

/**
 * Expires leave nobody got round to deciding on.
 *
 * Ported from `src/jobs/leaveRequestJob.js`. A PENDING request whose start date has passed
 * is not a decision anyone can still make — the day happened, with or without approval —
 * so it stops occupying the calendar and blocking an overlapping request.
 *
 * **00:01 Vietnam time, daily.** The old file carried a comment about that schedule worth
 * keeping: an earlier version used `"0 1 0 1 * *"`, six fields, so the fourth was read as
 * *day of month* and the job only ran on the 1st — contradicting its own comment. The
 * five-field `"1 0 * * *"` is the fix, and the timezone is explicit for the same reason
 * everything else in this codebase is.
 */
@Injectable()
export class LeaveRequestCronService {
  private readonly logger = new Logger(LeaveRequestCronService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationService,
  ) {}

  @Cron('1 0 * * *', { timeZone: 'Asia/Ho_Chi_Minh' })
  async expireOverdueRequests(): Promise<void> {
    if (process.env.NODE_ENV === 'test') return;

    // Loaded before the update, not after: once the status has changed there is no way to
    // tell which rows this run touched, and each one needs its owner notified. The old job
    // had the same comment.
    const overdue = await this.prisma.leaveRequest.findMany({
      where: {
        status: LeaveRequestStatus.PENDING,
        startDate: { lt: new Date() },
      },
      select: { id: true, userId: true, tenantId: true },
    });
    if (overdue.length === 0) return;

    const { count } = await this.prisma.leaveRequest.updateMany({
      where: { id: { in: overdue.map((request) => request.id) } },
      data: { status: LeaveRequestStatus.EXPIRED },
    });
    this.logger.log(`Expired ${count} overdue leave requests`);

    for (const request of overdue) {
      await this.notifications.notify({
        tenantId: request.tenantId,
        recipientIds: [request.userId],
        referenceId: request.id,
        ...LeaveRequestNotificationTemplates.expired(request.id),
      });
    }
  }
}
