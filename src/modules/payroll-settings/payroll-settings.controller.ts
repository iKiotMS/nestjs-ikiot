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
import { PayrollSettingService } from './payroll-settings.service';
import { CreatePayrollSettingDto } from './dto/create-payroll-settings.dto';
import { UpdatePayrollSettingDto } from './dto/update-payroll-settings.dto';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Permissions } from '../../common/decorators/permissions.decorator';
import {
  requireTenantId,
  resolveTenantScope,
} from '../../common/utils/tenant-scope';
import type { AuthUser } from '../../common/types/auth-user.type';

// Generated CRUD, not a real port yet: gated by the global JwtAuthGuard, scoped to the
// caller's tenant and permission-checked against the 'payrollSettings' catalog resource — but
// the service underneath is plain Prisma CRUD, not the real business logic.
@ApiTags('payroll-settings')
@ApiBearerAuth('bearer')
@Controller('payroll-settings')
export class PayrollSettingController {
  constructor(private readonly service: PayrollSettingService) {}

  @Permissions('payrollSettings', 'read')
  @Get()
  findAll(@CurrentUser() user: AuthUser, @Query('tenantId') tenantId?: string) {
    return this.service.findAll(resolveTenantScope(user, tenantId));
  }

  @Permissions('payrollSettings', 'read')
  @Get(':id')
  findOne(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Query('tenantId') tenantId?: string,
  ) {
    return this.service.findOne(resolveTenantScope(user, tenantId), id);
  }

  @Permissions('payrollSettings', 'create')
  @Post()
  create(
    @CurrentUser() user: AuthUser,
    @Body() dto: CreatePayrollSettingDto,
    @Query('tenantId') tenantId?: string,
  ) {
    return this.service.create(requireTenantId(user, tenantId), dto);
  }

  @Permissions('payrollSettings', 'update')
  @Patch(':id')
  update(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() dto: UpdatePayrollSettingDto,
    @Query('tenantId') tenantId?: string,
  ) {
    return this.service.update(resolveTenantScope(user, tenantId), id, dto);
  }

  @Permissions('payrollSettings', 'delete')
  @Delete(':id')
  remove(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Query('tenantId') tenantId?: string,
  ) {
    return this.service.remove(resolveTenantScope(user, tenantId), id);
  }
}
