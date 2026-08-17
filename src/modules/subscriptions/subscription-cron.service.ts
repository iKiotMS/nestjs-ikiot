import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../../prisma/prisma.service';
import { NotificationService } from '../notifications/notifications.service';
import { SubscriptionNotificationTemplates } from '../notifications/templates/subscription.templates';
import type { NotificationContent } from '../notifications/notification-content.type';
import { EmailService } from '../../common/email/email.service';
import {
  addDays,
  GRACE_PERIOD_DAYS,
  REMINDER_DAYS,
} from './subscription.constants';

const DAY_MS = 24 * 60 * 60 * 1000;

function startOfTodayUTC(): Date {
  const d = new Date();
  return new Date(
    Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()),
  );
}

// Ported from iKiotMS-BE's src/jobs/subscriptionJob.js (node-cron, "0 2 * * *") using
// @nestjs/schedule instead — same daily 02:00 schedule, same two-step run (status
// transitions, then expiry reminders), skipped in tests the same way the old app.js did.
@Injectable()
export class SubscriptionCronService {
  private readonly logger = new Logger(SubscriptionCronService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationService,
    private readonly email: EmailService,
  ) {}

  @Cron(CronExpression.EVERY_DAY_AT_2AM)
  async runDailyJob() {
    if (process.env.NODE_ENV === 'test') return;

    this.logger.log('Running daily subscription check...');
    try {
      await this.runSubscriptionStatusCheck();
      await this.sendExpiryReminders();
    } catch (error) {
      this.logger.error(
        'Unhandled error in daily subscription job',
        error instanceof Error ? error.stack : error,
      );
    }
  }

  async runSubscriptionStatusCheck() {
    const now = new Date();
    const graceCutoff = addDays(now, -GRACE_PERIOD_DAYS);

    // Capture who's about to transition BEFORE the bulk update — afterwards there's no
    // way to tell which rows just changed.
    const [trialsToExpire, toExpire] = await Promise.all([
      this.prisma.subscription.findMany({
        where: { status: 'TRIAL', trialEndDate: { lt: now } },
        select: { id: true, tenantId: true },
      }),
      this.prisma.subscription.findMany({
        where: { status: 'PAST_DUE', endDate: { lt: graceCutoff } },
        select: { id: true, tenantId: true },
      }),
    ]);

    const [expiredTrials, markedPastDue, markedExpired] = await Promise.all([
      this.prisma.subscription.updateMany({
        where: { status: 'TRIAL', trialEndDate: { lt: now } },
        data: { status: 'EXPIRED' },
      }),
      this.prisma.subscription.updateMany({
        where: { status: 'ACTIVE', endDate: { lt: now } },
        data: { status: 'PAST_DUE' },
      }),
      this.prisma.subscription.updateMany({
        where: { status: 'PAST_DUE', endDate: { lt: graceCutoff } },
        data: { status: 'EXPIRED' },
      }),
    ]);

    this.logger.log(
      `Trial expired: ${expiredTrials.count} | Past due: ${markedPastDue.count} | Expired: ${markedExpired.count}`,
    );

    await this.notifyStatusChange(
      trialsToExpire,
      SubscriptionNotificationTemplates.trialExpired(),
    );
    await this.notifyStatusChange(
      toExpire,
      SubscriptionNotificationTemplates.expired(),
    );
  }

  async sendExpiryReminders() {
    const today = startOfTodayUTC();

    for (const days of REMINDER_DAYS) {
      const windowStart = addDays(today, days);
      const windowEnd = new Date(windowStart.getTime() + DAY_MS);

      const subscriptions = await this.prisma.subscription.findMany({
        where: {
          status: { in: ['TRIAL', 'ACTIVE'] },
          endDate: { gte: windowStart, lt: windowEnd },
        },
        include: {
          plan: { select: { planName: true } },
          tenant: { select: { name: true } },
        },
      });

      for (const sub of subscriptions) {
        // Tenant.tenantOwnerId is an unenforced scalar (no Prisma relation, avoids a
        // circular FK at Tenant/User creation time) — look the owner up directly instead.
        const owner = await this.prisma.user.findFirst({
          where: {
            tenantId: sub.tenantId,
            systemRole: 'TENANT_OWNER',
            status: 'ACTIVE',
          },
          select: { id: true, email: true },
        });

        await this.notifications.notify({
          tenantId: sub.tenantId,
          recipientIds: [owner?.id],
          referenceId: sub.id,
          ...SubscriptionNotificationTemplates.expiring(
            days,
            sub.plan?.planName ?? 'dịch vụ',
          ),
        });

        if (!owner?.email) continue;
        await this.email.sendSubscriptionReminder(owner.email, {
          tenantName: sub.tenant?.name ?? 'Quý khách',
          planName: sub.plan?.planName ?? 'Gói dịch vụ',
          daysLeft: days,
          endDate: sub.endDate,
        });
      }
    }
  }

  private async notifyStatusChange(
    subscriptions: { id: string; tenantId: string }[],
    content: NotificationContent,
  ) {
    for (const sub of subscriptions) {
      const owners = await this.notifications.tenantOwners(sub.tenantId);
      await this.notifications.notify({
        tenantId: sub.tenantId,
        recipientIds: owners,
        referenceId: sub.id,
        ...content,
      });
    }
  }
}
