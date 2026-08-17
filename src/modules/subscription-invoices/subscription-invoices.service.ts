import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

// Read-only from this module's own controller — invoices are only ever written by
// SubscriptionService (create on upgrade/renew initiate, mark PAID on webhook), which
// talks to the SubscriptionInvoice table directly via PrismaService rather than through
// this service, matching how iKiotMS-BE's SubscriptionService used the Mongoose model
// directly instead of going through a separate abstraction for writes.
@Injectable()
export class SubscriptionInvoiceService {
  constructor(private readonly prisma: PrismaService) {}

  listForTenant(tenantId: string) {
    return this.prisma.subscriptionInvoice.findMany({
      where: { tenantId },
      include: { plan: { select: { planName: true, planCode: true } } },
      orderBy: { createdAt: 'desc' },
      take: 20,
    });
  }

  listAll() {
    return this.prisma.subscriptionInvoice.findMany({
      include: {
        plan: { select: { planName: true, planCode: true } },
        tenant: { select: { name: true, phoneNumber: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async getStatus(tenantId: string, invoiceId: string) {
    const invoice = await this.prisma.subscriptionInvoice.findFirst({
      where: { id: invoiceId, tenantId },
    });
    if (!invoice) throw new NotFoundException('Invoice not found');
    return { status: invoice.status, paidAt: invoice.paidAt };
  }
}
