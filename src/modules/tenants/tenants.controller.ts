import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { TenantService } from './tenants.service';
import { CreateTenantDto } from './dto/create-tenants.dto';
import { UpdateTenantDto } from './dto/update-tenants.dto';
import { Permissions } from '../../common/decorators/permissions.decorator';
import { AdminOnlyGuard } from '../../common/guards/admin-only.guard';

// Generated CRUD, not a real port yet: the service underneath is plain Prisma CRUD.
//
// **Platform-admin only, and that has to be a guard rather than `@Permissions`.** `Tenant`
// is the one model with no `tenantId` of its own, so there is nothing to scope a request
// by — and `PermissionsGuard` short-circuits `TENANT_OWNER` before it checks anything,
// which meant `@Permissions('tenants', …)` alone let any shop owner list, edit and delete
// *every other tenant on the platform*. `AdminOnlyGuard` is what `/admin/plans` and
// `/admin/audit-logs` use for exactly this reason (see CLAUDE.md "Authorization").
//
// Global guards run before controller-scoped ones, so `request.user` is already populated
// by JwtAuthGuard when this runs. The `@Permissions()` decorators stay so the pairs keep
// their route in `scripts/check-permissions.js`; the guard is what keeps tenants out.
@ApiTags('tenants')
@ApiBearerAuth('bearer')
@UseGuards(AdminOnlyGuard)
@Controller('tenants')
export class TenantController {
  constructor(private readonly service: TenantService) {}

  @Permissions('tenants', 'read')
  @Get()
  findAll() {
    return this.service.findAll();
  }

  @Permissions('tenants', 'read')
  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.service.findOne(id);
  }

  @Permissions('tenants', 'create')
  @Post()
  create(@Body() dto: CreateTenantDto) {
    return this.service.create(dto);
  }

  @Permissions('tenants', 'update')
  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdateTenantDto) {
    return this.service.update(id, dto);
  }

  @Permissions('tenants', 'delete')
  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.service.remove(id);
  }
}
