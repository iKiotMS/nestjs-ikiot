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
import { WorkingScheduleService } from './working-schedules.service';
import { CreateWorkingScheduleDto } from './dto/create-working-schedules.dto';
import { UpdateWorkingScheduleDto } from './dto/update-working-schedules.dto';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Permissions } from '../../common/decorators/permissions.decorator';
import {
  requireTenantId,
  resolveTenantScope,
} from '../../common/utils/tenant-scope';
import type { AuthUser } from '../../common/types/auth-user.type';

// Generated CRUD, not a real port yet: gated by the global JwtAuthGuard, scoped to the
// caller's tenant and permission-checked against the 'schedules' catalog resource — but
// the service underneath is plain Prisma CRUD, not the real business logic.
@ApiTags('working-schedules')
@ApiBearerAuth('bearer')
@Controller('working-schedules')
export class WorkingScheduleController {
  constructor(private readonly service: WorkingScheduleService) {}

  @Permissions('schedules', 'read')
  @Get()
  findAll(@CurrentUser() user: AuthUser, @Query('tenantId') tenantId?: string) {
    return this.service.findAll(resolveTenantScope(user, tenantId));
  }

  @Permissions('schedules', 'read')
  @Get(':id')
  findOne(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Query('tenantId') tenantId?: string,
  ) {
    return this.service.findOne(resolveTenantScope(user, tenantId), id);
  }

  @Permissions('schedules', 'create')
  @Post()
  create(
    @CurrentUser() user: AuthUser,
    @Body() dto: CreateWorkingScheduleDto,
    @Query('tenantId') tenantId?: string,
  ) {
    return this.service.create(
      requireTenantId(user, tenantId),
      user.userId,
      dto,
    );
  }

  @Permissions('schedules', 'update')
  @Patch(':id')
  update(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() dto: UpdateWorkingScheduleDto,
    @Query('tenantId') tenantId?: string,
  ) {
    return this.service.update(resolveTenantScope(user, tenantId), id, dto);
  }

  @Permissions('schedules', 'delete')
  @Delete(':id')
  remove(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Query('tenantId') tenantId?: string,
  ) {
    return this.service.remove(resolveTenantScope(user, tenantId), id);
  }
}
