import { Controller, Get, Param, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CashFlowService } from './cash-flows.service';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Permissions } from '../../common/decorators/permissions.decorator';
import { resolveTenantScope } from '../../common/utils/tenant-scope';
import type { AuthUser } from '../../common/types/auth-user.type';

/**
 * **Read-only, and that is the whole design.**
 *
 * iKiotMS-BE never exposed a route that wrote a `CashFlow` row. The ledger is written by
 * the events that actually moved money — a completed sale and its change
 * (`OrderService.writeSaleCashFlows`), a return, a supplier debt payment
 * (`SupplierService.payDebt`), a payroll period being marked paid — and read back through
 * the stats endpoints. The generated CRUD introduced `POST`/`PATCH`/`DELETE` here, which
 * is a way to book revenue that never happened, delete revenue that did, and put the till
 * count out of step with the sales that produced it. Removed.
 *
 * If a shop genuinely needs to record cash that no other flow explains, that is a feature
 * with its own rules (who may, against which branch, with what justification) — not a
 * generic `POST` over the ledger.
 *
 * The `cash_flows:create`/`update`/`delete` catalog pairs are consequently unused;
 * `scripts/check-permissions.js` lists them, which is expected.
 */
@ApiTags('cash-flows')
@ApiBearerAuth('bearer')
@Controller('cash-flows')
export class CashFlowController {
  constructor(private readonly service: CashFlowService) {}

  @Permissions('cash_flows', 'read')
  @Get()
  findAll(@CurrentUser() user: AuthUser, @Query('tenantId') tenantId?: string) {
    return this.service.findAll(resolveTenantScope(user, tenantId));
  }

  @Permissions('cash_flows', 'read')
  @Get(':id')
  findOne(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Query('tenantId') tenantId?: string,
  ) {
    return this.service.findOne(resolveTenantScope(user, tenantId), id);
  }
}
