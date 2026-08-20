import {
  BadRequestException,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import {
  addDays,
  getBillingDays,
  GRACE_PERIOD_DAYS,
  wholeDaysBetween,
} from './subscription.constants';
import {
  nextSubscriptionStatus,
  SubscriptionStatus,
} from './subscription-status';
import type { Plan, Subscription } from '../../../generated/prisma/client';

/**
 * Every quota frozen onto a subscription at purchase time. Derived from the schema rather
 * than listed by hand, so adding a `quotaSnapshotMaxX` column to Subscription makes it
 * usable here immediately — the old hardcoded two-value union had to be edited first.
 */
export type QuotaField = Extract<keyof Subscription, `quotaSnapshot${string}`>;

/**
 * Ported from iKiotMS-BE's SubscriptionService
 * (src/modules/subscription/service/SubscriptionService.js).
 *
 * Owns the *state* of a tenant's subscription: which plan they are on, whether it is still
 * live, and what their plan lets them do. Everything to do with getting paid — invoices,
 * QR codes, the SePay webhook — lives next door in SubscriptionBillingService, which the
 * old single service mixed in with all of this.
 */
@Injectable()
export class SubscriptionService {
  constructor(private readonly prisma: PrismaService) {}

  async assignFreeTrial(tenantId: string, userId: string) {
    const existing = await this.prisma.subscription.findFirst({
      where: { tenantId },
    });
    if (existing)
      throw new BadRequestException('Tenant already has a subscription');

    const plan = await this.prisma.plan.findFirst({
      where: { planCode: 'TRIAL', isActive: true },
    });
    if (!plan) throw new BadRequestException('Free trial plan not available');

    const startDate = new Date();
    const trialEndDate = addDays(startDate, plan.trialDays);

    const subscription = await this.prisma.subscription.create({
      data: {
        tenantId,
        planId: plan.id,
        status: SubscriptionStatus.TRIAL,
        startDate,
        endDate: new Date(trialEndDate),
        trialEndDate,
        autoRenew: true,
        ...quotaSnapshotOf(plan),
        historyLogs: {
          create: {
            event: 'CREATED',
            toPlanId: plan.id,
            changedAt: startDate,
            changedById: userId,
            note: 'Free trial assigned to existing account',
          },
        },
      },
    });

    return {
      subscription: {
        id: subscription.id,
        status: subscription.status,
        trialEndDate: subscription.trialEndDate,
      },
      plan: {
        id: plan.id,
        planName: plan.planName,
        planCode: plan.planCode,
        trialDays: plan.trialDays,
      },
    };
  }

  /**
   * Returns the subscription with its status already brought up to date in the DB.
   *
   * The nightly cron does the same sweep in bulk, but a tenant must never be served on a
   * term that ran out an hour ago, so every reader goes through here too. The rules
   * themselves live in `nextSubscriptionStatus` — this only persists what they decide.
   */
  private async settleSubscription(
    tenantId: string,
  ): Promise<(Subscription & { plan: Plan | null }) | null> {
    const subscription = await this.prisma.subscription.findFirst({
      where: { tenantId },
      include: { plan: true },
    });
    if (!subscription) return null;

    const status = nextSubscriptionStatus(subscription, new Date());
    if (status !== subscription.status) {
      await this.prisma.subscription.update({
        where: { id: subscription.id },
        data: { status },
      });
      subscription.status = status;
    }
    return subscription;
  }

  async checkTrialStatus(tenantId: string) {
    const subscription = await this.settleSubscription(tenantId);
    if (!subscription) return { status: 'NO_SUBSCRIPTION' as const };

    const now = new Date();
    const { endDate, trialEndDate, plan } = subscription;

    switch (subscription.status) {
      case SubscriptionStatus.TRIAL:
        return {
          status: SubscriptionStatus.TRIAL,
          daysLeft: trialEndDate ? wholeDaysBetween(now, trialEndDate) : null,
          trialEndDate,
        };
      case SubscriptionStatus.EXPIRED:
        // endDate equals trialEndDate for trials (assignFreeTrial sets both), so this is
        // the right anchor whether the subscription expired as a trial or as a paid term.
        return {
          status: SubscriptionStatus.EXPIRED,
          daysOverdue: wholeDaysBetween(endDate, now),
        };
      case SubscriptionStatus.PAST_DUE:
        return {
          status: SubscriptionStatus.PAST_DUE,
          daysOverdue: wholeDaysBetween(endDate, now),
          gracePeriodEndsAt: addDays(endDate, GRACE_PERIOD_DAYS),
          endDate,
          planCode: plan?.planCode,
        };
      case SubscriptionStatus.ACTIVE:
        return {
          status: SubscriptionStatus.ACTIVE,
          daysLeft: wholeDaysBetween(now, endDate),
          endDate,
          planCode: plan?.planCode,
        };
      default:
        return { status: subscription.status };
    }
  }

  /**
   * The equivalent of iKiotMS-BE's `requireActiveSubscription` middleware, as a service
   * call instead of a guard: callers need the row itself (for its quota snapshot), not
   * just a yes/no. PAST_DUE deliberately passes — that is what the grace period is for.
   */
  async requireActiveSubscription(
    tenantId: string,
  ): Promise<Subscription & { plan: Plan | null }> {
    const subscription = await this.settleSubscription(tenantId);
    if (!subscription) {
      throw new ForbiddenException('Cửa hàng chưa có gói dịch vụ nào');
    }
    if (subscription.status === SubscriptionStatus.EXPIRED) {
      throw new ForbiddenException(
        'Gói dịch vụ đã hết hạn. Vui lòng gia hạn để tiếp tục sử dụng.',
      );
    }
    if (subscription.status === SubscriptionStatus.CANCELLED) {
      throw new ForbiddenException(
        'Gói dịch vụ đã bị huỷ. Vui lòng đăng ký lại để tiếp tục sử dụng.',
      );
    }
    return subscription;
  }

  /**
   * Shared quota gate for the "how many X can this tenant have" limits frozen onto the
   * subscription at purchase time.
   *
   * A negative limit (`-1`, what the plans use) means unlimited, and so does `null` — a
   * row written before the column existed. `0` is a real limit of zero and blocks
   * everything; it used to be lumped in with "unlimited", which turned a plan configured
   * to allow no branches at all into a plan that allowed any number of them.
   *
   * `count` is a thunk so no counting query runs for tenants on an unlimited plan.
   */
  async assertQuota(
    tenantId: string,
    quota: QuotaField,
    count: () => Promise<number>,
    label: string,
  ): Promise<void> {
    const subscription = await this.requireActiveSubscription(tenantId);
    const max = subscription[quota];
    if (max === null || max < 0) return;

    const current = await count();
    if (current >= max) {
      throw new BadRequestException(
        `Đã đạt giới hạn ${label} của gói dịch vụ (tối đa ${max}, hiện có ${current}). Vui lòng nâng cấp gói.`,
      );
    }
  }

  /** Admin-only: change a tenant's plan directly, no payment involved. */
  async adminUpgradePlan(
    tenantId: string,
    adminUserId: string,
    newPlanCode: string,
  ) {
    const currentSubscription = await this.prisma.subscription.findFirst({
      where: { tenantId },
    });
    if (!currentSubscription)
      throw new BadRequestException('No active subscription found');

    const newPlan = await this.prisma.plan.findFirst({
      where: { planCode: newPlanCode, isActive: true },
    });
    if (!newPlan)
      throw new BadRequestException(
        `Plan ${newPlanCode} not found or inactive`,
      );

    const oldPlan = currentSubscription.planId
      ? await this.prisma.plan.findUnique({
          where: { id: currentSubscription.planId },
        })
      : null;

    const now = new Date();
    const updated = await this.prisma.subscription.update({
      where: { id: currentSubscription.id },
      data: {
        planId: newPlan.id,
        status: SubscriptionStatus.ACTIVE,
        startDate: now,
        endDate: addDays(now, getBillingDays(newPlan.billingCycle)),
        trialEndDate: null,
        ...quotaSnapshotOf(newPlan),
        historyLogs: {
          create: {
            event: 'UPGRADED',
            fromPlanId: currentSubscription.planId,
            toPlanId: newPlan.id,
            changedAt: now,
            changedById: adminUserId,
            note: `Upgraded from ${oldPlan?.planCode ?? 'unknown'} to ${newPlanCode}`,
          },
        },
      },
    });

    return { subscription: updated, oldPlan, newPlan };
  }
}

/**
 * Freezes the plan's limits onto the subscription. Quotas are snapshotted at purchase time
 * and never read live off the Plan, so a later price-list change can't retroactively shrink
 * an existing customer — which also means every write site has to copy all four fields, and
 * this is the one place that does it.
 */
export function quotaSnapshotOf(
  plan: Pick<
    Plan,
    'maxBranches' | 'maxWarehouses' | 'maxUsers' | 'maxProducts'
  >,
): Pick<Subscription, QuotaField> {
  return {
    quotaSnapshotMaxBranches: plan.maxBranches,
    quotaSnapshotMaxWarehouses: plan.maxWarehouses,
    quotaSnapshotMaxUsers: plan.maxUsers,
    quotaSnapshotMaxProducts: plan.maxProducts,
  };
}
