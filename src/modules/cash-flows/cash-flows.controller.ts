import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CashFlowService } from './cash-flows.service';
import { CreateCashFlowDto } from './dto/create-cash-flows.dto';
import { UpdateCashFlowDto } from './dto/update-cash-flows.dto';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Permissions } from '../../common/decorators/permissions.decorator';
import {
  requireTenantId,
  resolveTenantScope,
} from '../../common/utils/tenant-scope';
import type { AuthUser } from '../../common/types/auth-user.type';

// Generated CRUD, not a real port yet: gated by the global JwtAuthGuard, scoped to the
// caller's tenant and permission-checked against the 'cash_flows' catalog resource — but
// the service underneath is plain Prisma CRUD, not the real business logic.
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

  @Permissions('cash_flows', 'create')
  @Post()
  create(
    @CurrentUser() user: AuthUser,
    @Body() dto: CreateCashFlowDto,
    @Query('tenantId') tenantId?: string,
  ) {
    return this.service.create(
      requireTenantId(user, tenantId),
      user.userId,
      dto,
    );
  }

  @Permissions('cash_flows', 'update')
  @Patch(':id')
  update(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() dto: UpdateCashFlowDto,
    @Query('tenantId') tenantId?: string,
  ) {
    return this.service.update(resolveTenantScope(user, tenantId), id, dto);
  }

  @Permissions('cash_flows', 'delete')
  @Delete(':id')
  remove(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Query('tenantId') tenantId?: string,
  ) {
    return this.service.remove(resolveTenantScope(user, tenantId), id);
  }
}
