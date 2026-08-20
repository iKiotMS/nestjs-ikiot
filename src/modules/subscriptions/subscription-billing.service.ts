import {
  BadRequestException,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { NotificationService } from '../notifications/notifications.service';
import { SubscriptionNotificationTemplates } from '../notifications/templates/subscription.templates';
import { RealtimeGateway } from '../../common/realtime/realtime.gateway';
import { SepaySubscriptionService } from './sepay-subscription.service';
import { quotaSnapshotOf } from './subscriptions.service';
import { SubscriptionStatus } from './subscription-status';
import {
  addDays,
  getBillingDays,
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

/** What POST /webhook/sepay answers with. Always HTTP 200 — see handleSepayWebhook. */
export interface SepayWebhookResult {
  success: boolean;
  message?: string;
}

/**
 * The getting-paid half of iKiotMS-BE's SubscriptionService: raising an invoice for an
 * upgrade or a renewal, and turning SePay's "money arrived" callback into an activated
 * subscription.
 *
 * Split out of SubscriptionService during the port. That service had grown to cover plan
 * state, quota gates, invoices and webhook handling at once — four responsibilities that
 * barely touch each other (nothing in here reads a quota, nothing over there raises an
 * invoice), which made it the file nobody wanted to open.
 */
@Injectable()
export class SubscriptionBillingService {
  private readonly logger = new Logger(SubscriptionBillingService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly sepay: SepaySubscriptionService,
    private readonly notifications: NotificationService,
    private readonly realtime: RealtimeGateway,
  ) {}

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

  /**
   * Called by SePay when money lands in iKiot's own bank account.
   *
   * Every outcome except a bad API key resolves normally, so the controller can answer a
   * flat HTTP 200 and SePay never retries into one of our bugs — including the unexpected
   * errors caught at the bottom. A wrong API key is the one case worth a real 401: it is
   * not a payment we mishandled, it is a caller we don't recognise.
   *
   * (This used to return `{ httpStatus, body }` for the controller to apply by hand, which
   * made it the only service in the app that knew anything about HTTP.)
   */
  async handleSepayWebhook(
    apiKey: string,
    payload: SepayWebhookPayload,
  ): Promise<SepayWebhookResult> {
    if (!this.sepay.verifyWebhookKey(apiKey)) {
      throw new UnauthorizedException('Invalid API key');
    }

    try {
      return await this.settlePayment(payload);
    } catch (error) {
      this.logger.error(
        'SePay webhook error',
        error instanceof Error ? error.stack : error,
      );
      return {
        success: false,
        message: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  /** The webhook's actual work, minus the "never make SePay retry" wrapper around it. */
  private async settlePayment(
    payload: SepayWebhookPayload,
  ): Promise<SepayWebhookResult> {
    if (payload.transferType !== 'in') return { success: true };

    const paymentReference = this.sepay.extractReference(payload.content ?? '');
    if (!paymentReference) {
      return { success: true, message: 'No matching reference found' };
    }

    const invoice = await this.prisma.subscriptionInvoice.findFirst({
      where: { paymentReference, status: 'PENDING' },
    });
    if (!invoice) {
      return {
        success: true,
        message: 'Invoice not found or already processed',
      };
    }

    if ((payload.transferAmount ?? 0) < Number(invoice.amount)) {
      this.logger.warn(
        `Underpaid invoice ${invoice.id}. Expected ${invoice.amount.toString()}, got ${payload.transferAmount}`,
      );
      return { success: true, message: 'Underpaid — ignored' };
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

    return { success: true, message: 'Subscription activated' };
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
          status: SubscriptionStatus.ACTIVE,
          startDate: billingStart,
          endDate: billingEnd,
          trialEndDate: null,
          ...quotaSnapshotOf(plan),
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
}
