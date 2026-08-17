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
import { PayrollPeriodService } from './payroll-periods.service';
import { CreatePayrollPeriodDto } from './dto/create-payroll-periods.dto';
import { UpdatePayrollPeriodDto } from './dto/update-payroll-periods.dto';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Permissions } from '../../common/decorators/permissions.decorator';
import {
  requireTenantId,
  resolveTenantScope,
} from '../../common/utils/tenant-scope';
import type { AuthUser } from '../../common/types/auth-user.type';

// Generated CRUD, not a real port yet: gated by the global JwtAuthGuard, scoped to the
// caller's tenant and permission-checked against the 'payroll' catalog resource — but
// the service underneath is plain Prisma CRUD, not the real business logic.
@ApiTags('payroll-periods')
@ApiBearerAuth('bearer')
@Controller('payroll-periods')
export class PayrollPeriodController {
  constructor(private readonly service: PayrollPeriodService) {}

  @Permissions('payroll', 'read')
  @Get()
  findAll(@CurrentUser() user: AuthUser, @Query('tenantId') tenantId?: string) {
    return this.service.findAll(resolveTenantScope(user, tenantId));
  }

  @Permissions('payroll', 'read')
  @Get(':id')
  findOne(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Query('tenantId') tenantId?: string,
  ) {
    return this.service.findOne(resolveTenantScope(user, tenantId), id);
  }

  @Permissions('payroll', 'create')
  @Post()
  create(
    @CurrentUser() user: AuthUser,
    @Body() dto: CreatePayrollPeriodDto,
    @Query('tenantId') tenantId?: string,
  ) {
    return this.service.create(requireTenantId(user, tenantId), dto);
  }

  @Permissions('payroll', 'update')
  @Patch(':id')
  update(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() dto: UpdatePayrollPeriodDto,
    @Query('tenantId') tenantId?: string,
  ) {
    return this.service.update(resolveTenantScope(user, tenantId), id, dto);
  }

  @Permissions('payroll', 'delete')
  @Delete(':id')
  remove(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Query('tenantId') tenantId?: string,
  ) {
    return this.service.remove(resolveTenantScope(user, tenantId), id);
  }
}
