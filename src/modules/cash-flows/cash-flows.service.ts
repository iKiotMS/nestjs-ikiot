import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

/**
 * Reads over the money ledger. Nothing here writes — see the controller for why.
 *
 * The real transaction listing (filters, date range, running totals) belongs to the stats
 * module, which is iKiotMS-BE's `/stats/cashflow` and `/stats/cashflow/transactions`.
 * Until that lands, `findAll` is the unfiltered list the generated module shipped with.
 */
@Injectable()
export class CashFlowService {
  constructor(private readonly prisma: PrismaService) {}

  findAll(tenantId?: string) {
    return this.prisma.cashFlow.findMany({
      where: { ...(tenantId ? { tenantId } : {}) },
      orderBy: { createdAt: 'desc' },
    });
  }

  // findFirst + explicit throw rather than findFirstOrThrow: Prisma's own not-found error
  // isn't an HttpException, so Nest turns it into a 500. A row in another tenant must be
  // indistinguishable from one that doesn't exist — 404 either way, never 403.
  async findOne(tenantId: string | undefined, id: string) {
    const found = await this.prisma.cashFlow.findFirst({
      where: { id, ...(tenantId ? { tenantId } : {}) },
    });
    if (!found) throw new NotFoundException('CashFlow not found');
    return found;
  }
}
