import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateSubscriptionInvoiceDto } from './dto/create-subscription-invoices.dto';
import { UpdateSubscriptionInvoiceDto } from './dto/update-subscription-invoices.dto';

@Injectable()
export class SubscriptionInvoiceService {
  constructor(private readonly prisma: PrismaService) {}

  findAll(tenantId?: string) {
    return this.prisma.subscriptionInvoice.findMany(tenantId ? { where: { tenantId } } : undefined);
  }

  findOne(id: string) {
    return this.prisma.subscriptionInvoice.findUniqueOrThrow({ where: { id } });
  }

  create(data: CreateSubscriptionInvoiceDto) {
    return this.prisma.subscriptionInvoice.create({ data: data as any });
  }

  update(id: string, data: UpdateSubscriptionInvoiceDto) {
    return this.prisma.subscriptionInvoice.update({ where: { id }, data: data as any });
  }

  remove(id: string) {
    return this.prisma.subscriptionInvoice.delete({ where: { id } });
  }
}
