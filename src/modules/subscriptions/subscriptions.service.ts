import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { NotificationService } from '../notifications/notifications.service';
import { SubscriptionNotificationTemplates } from '../notifications/templates/subscription.templates';
import { RealtimeGateway } from '../../common/realtime/realtime.gateway';
import { SepaySubscriptionService } from './sepay-subscription.service';
import {
  addDays,
  getBillingDays,
  GRACE_PERIOD_DAYS,
  QR_EXPIRY_MS,
} from './subscription.constants';
import type {
  Plan,
  Subscription,
  SubscriptionInvoice,
} from '../../../generated/prisma/client';

export interface SepayWebhookPayload {
  transferType?: string;
  content?: string;
  transferAmount?: number;
  referenceCode?: string;
  id?: number | string;
}

// Ported from iKiotMS-BE's SubscriptionService (src/modules/subscription/service/SubscriptionService.js).
// Deliberately covers Plan/Subscription/SubscriptionInvoice together in one service, same
// as the old one did across all 3 Mongoose models directly — they're written inside the
// same transactions too often to split cleanly across module boundaries.
@Injectable()
export class SubscriptionService {
  private readonly logger = new Logger(SubscriptionService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly sepay: SepaySubscriptionService,
    private readonly notifications: NotificationService,
    private readonly realtime: RealtimeGateway,
  ) {}

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
        status: 'TRIAL',
        startDate,
        endDate: new Date(trialEndDate),
        trialEndDate,
        autoRenew: true,
        quotaSnapshotMaxBranches: plan.maxBranches,
        quotaSnapshotMaxUsers: plan.maxUsers,
        quotaSnapshotMaxProducts: plan.maxProducts,
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

  async checkTrialStatus(tenantId: string) {
    const subscription = await this.prisma.subscription.findFirst({
      where: { tenantId },
      include: { plan: true },
    });
    if (!subscription) return { status: 'NO_SUBSCRIPTION' as const };

    const now = new Date();

    if (subscription.status === 'TRIAL') {
      if (subscription.trialEndDate && now > subscription.trialEndDate) {
        await this.prisma.subscription.update({
          where: { id: subscription.id },
          data: { status: 'EXPIRED' },
        });
        return {
          status: 'EXPIRED',
          daysOverdue: this.daysBetween(subscription.trialEndDate, now),
        };
      }
      return {
        status: 'TRIAL',
        daysLeft: subscription.trialEndDate
          ? this.daysBetween(now, subscription.trialEndDate)
          : null,
        trialEndDate: subscription.trialEndDate,
      };
    }

    if (
      subscription.status === 'ACTIVE' ||
      subscription.status === 'PAST_DUE'
    ) {
      const endDate = subscription.endDate;
      const graceCutoff = addDays(now, -GRACE_PERIOD_DAYS);

      if (endDate < graceCutoff) {
        await this.prisma.subscription.update({
          where: { id: subscription.id },
          data: { status: 'EXPIRED' },
        });
        return {
          status: 'EXPIRED',
          daysOverdue: this.daysBetween(endDate, now),
        };
      }

      if (now > endDate) {
        if (subscription.status === 'ACTIVE') {
          await this.prisma.subscription.update({
            where: { id: subscription.id },
            data: { status: 'PAST_DUE' },
          });
        }
        return {
          status: 'PAST_DUE',
          daysOverdue: this.daysBetween(endDate, now),
          gracePeriodEndsAt: addDays(endDate, GRACE_PERIOD_DAYS),
          endDate,
          planCode: subscription.plan?.planCode,
        };
      }

      return {
        status: 'ACTIVE',
        daysLeft: this.daysBetween(now, endDate),
        endDate,
        planCode: subscription.plan?.planCode,
      };
    }

    return { status: subscription.status };
  }

  async initiateUpgrade(tenantId: string, planCode: string) {
    const currentSubscription = await this.prisma.subscription.findFirst({
      where: { tenantId },
    });
    if (!currentSubscription)
      throw new BadRequestException('No active subscription found');

    const newPlan = await this.prisma.plan.findFirst({
      where: { planCode, isActive: true },
    });
    if (!newPlan)
      throw new BadRequestException(`Plan ${planCode} not found or inactive`);
    if (Number(newPlan.price) === 0)
      throw new BadRequestException('Use free-trial endpoint for free plans');

    return this.createPlanInvoice(currentSubscription, newPlan);
  }

  async initiateRenewal(tenantId: string) {
    const currentSubscription = await this.prisma.subscription.findFirst({
      where: { tenantId },
      include: { plan: true },
    });
    if (!currentSubscription)
      throw new BadRequestException('No subscription found');

    const currentPlan = currentSubscription.plan;
    if (!currentPlan) throw new BadRequestException('Current plan not found');
    if (currentPlan.planCode === 'TRIAL' || Number(currentPlan.price) === 0) {
      throw new BadRequestException(
        'Trial plan cannot be renewed. Please upgrade to a paid plan.',
      );
    }

    return this.createPlanInvoice(currentSubscription, currentPlan);
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

    const updated = await this.prisma.subscription.update({
      where: { id: currentSubscription.id },
      data: {
        planId: newPlan.id,
        status: 'ACTIVE',
        startDate: new Date(),
        endDate: addDays(new Date(), getBillingDays(newPlan.billingCycle)),
        trialEndDate: null,
        quotaSnapshotMaxBranches: newPlan.maxBranches,
        quotaSnapshotMaxUsers: newPlan.maxUsers,
        quotaSnapshotMaxProducts: newPlan.maxProducts,
        historyLogs: {
          create: {
            event: 'UPGRADED',
            fromPlanId: currentSubscription.planId,
            toPlanId: newPlan.id,
            changedAt: new Date(),
            changedById: adminUserId,
            note: `Upgraded from ${oldPlan?.planCode ?? 'unknown'} to ${newPlanCode}`,
          },
        },
      },
    });

    return { subscription: updated, oldPlan, newPlan };
  }

  async handleSepayWebhook(
    apiKey: string,
    payload: SepayWebhookPayload,
  ): Promise<{ httpStatus: number; body: Record<string, unknown> }> {
    try {
      if (!this.sepay.verifyWebhookKey(apiKey)) {
        return {
          httpStatus: 401,
          body: { success: false, message: 'Invalid API key' },
        };
      }
      if (payload.transferType !== 'in') {
        return { httpStatus: 200, body: { success: true } };
      }

      const paymentReference = this.sepay.extractReference(
        payload.content ?? '',
      );
      if (!paymentReference) {
        return {
          httpStatus: 200,
          body: { success: true, message: 'No matching reference found' },
        };
      }

      const invoice = await this.prisma.subscriptionInvoice.findFirst({
        where: { paymentReference, status: 'PENDING' },
      });
      if (!invoice) {
        return {
          httpStatus: 200,
          body: {
            success: true,
            message: 'Invoice not found or already processed',
          },
        };
      }

      if ((payload.transferAmount ?? 0) < Number(invoice.amount)) {
        this.logger.warn(
          `Underpaid invoice ${invoice.id}. Expected ${invoice.amount.toString()}, got ${payload.transferAmount}`,
        );
        return {
          httpStatus: 200,
          body: { success: true, message: 'Underpaid — ignored' },
        };
      }

      const subscription = await this.activateAfterPayment(invoice, payload);

      const owners = await this.notifications.tenantOwners(invoice.tenantId);
      await this.notifications.notify({
        tenantId: invoice.tenantId,
        recipientIds: owners,
        referenceId: invoice.id,
        ...SubscriptionNotificationTemplates.activated(),
      });
      this.realtime.emitToRoom(
        `tenant:${invoice.tenantId}`,
        'subscription:activated',
        {
          invoiceId: invoice.id,
          planId: subscription.planId,
          status: subscription.status,
          endDate: subscription.endDate,
        },
      );

      return {
        httpStatus: 200,
        body: { success: true, message: 'Subscription activated' },
      };
    } catch (error) {
      // Always 200 on unexpected error too — SePay must not retry indefinitely on our bugs.
      this.logger.error(
        'SePay webhook error',
        error instanceof Error ? error.stack : error,
      );
      return {
        httpStatus: 200,
        body: {
          success: false,
          message: error instanceof Error ? error.message : 'Unknown error',
        },
      };
    }
  }

  private async activateAfterPayment(
    invoice: SubscriptionInvoice,
    sepayPayload: SepayWebhookPayload,
  ): Promise<Subscription> {
    const plan = await this.prisma.plan.findUnique({
      where: { id: invoice.planId },
    });
    if (!plan) throw new Error('Plan not found');

    const subscription = await this.prisma.subscription.findUnique({
      where: { id: invoice.subscriptionId },
    });
    if (!subscription) throw new Error('Subscription not found');

    const oldPlanId = subscription.planId;
    const isRenewal = oldPlanId === invoice.planId;

    const billingStart = new Date();
    const billingEnd = addDays(billingStart, getBillingDays(plan.billingCycle));

    const [updatedSubscription] = await this.prisma.$transaction([
      this.prisma.subscription.update({
        where: { id: subscription.id },
        data: {
          planId: plan.id,
          status: 'ACTIVE',
          startDate: billingStart,
          endDate: billingEnd,
          trialEndDate: null,
          quotaSnapshotMaxBranches: plan.maxBranches,
          quotaSnapshotMaxUsers: plan.maxUsers,
          quotaSnapshotMaxProducts: plan.maxProducts,
          historyLogs: {
            create: {
              event: isRenewal ? 'RENEWED' : 'UPGRADED',
              fromPlanId: oldPlanId,
              toPlanId: plan.id,
              changedAt: new Date(),
              // No acting user for a webhook-triggered activation — iKiotMS-BE stored
              // tenantId here instead, which read confusingly in a "changed by user" field.
              changedById: null,
              note: isRenewal
                ? `Renewed ${plan.planCode} via SePay (ref: ${invoice.paymentReference})`
                : `Upgraded to ${plan.planCode} via SePay (ref: ${invoice.paymentReference})`,
            },
          },
        },
      }),
      this.prisma.subscriptionInvoice.update({
        where: { id: invoice.id },
        data: {
          status: 'PAID',
          paidAt: new Date(),
          transactionRef:
            sepayPayload.referenceCode ?? String(sepayPayload.id ?? ''),
        },
      }),
    ]);

    return updatedSubscription;
  }

  private async createPlanInvoice(
    subscription: Pick<Subscription, 'id' | 'tenantId'>,
    plan: Plan,
  ) {
    await this.prisma.subscriptionInvoice.updateMany({
      where: {
        tenantId: subscription.tenantId,
        planId: plan.id,
        status: 'PENDING',
      },
      data: { status: 'FAILED' },
    });

    const billingStart = new Date();
    const billingEnd = addDays(billingStart, getBillingDays(plan.billingCycle));
    const paymentReference = this.sepay.generatePaymentReference();

    const invoice = await this.prisma.subscriptionInvoice.create({
      data: {
        subscriptionId: subscription.id,
        tenantId: subscription.tenantId,
        planId: plan.id,
        amount: plan.price,
        currency: 'VND',
        status: 'PENDING',
        paymentReference,
        paymentMethod: 'SEPAY',
        billingPeriodStart: billingStart,
        billingPeriodEnd: billingEnd,
      },
    });

    const amount = Number(plan.price);
    return {
      invoiceId: invoice.id,
      paymentReference,
      amount,
      plan: { planCode: plan.planCode, planName: plan.planName },
      qrDataUrl: this.sepay.buildQrUrl(amount, paymentReference),
      expiredAt: new Date(Date.now() + QR_EXPIRY_MS),
    };
  }

  private daysBetween(earlier: Date, later: Date): number {
    return Math.ceil((later.getTime() - earlier.getTime()) / 86_400_000);
  }
}
