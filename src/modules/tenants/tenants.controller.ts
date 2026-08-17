import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { TenantService } from './tenants.service';
import { CreateTenantDto } from './dto/create-tenants.dto';
import { UpdateTenantDto } from './dto/update-tenants.dto';
import { Permissions } from '../../common/decorators/permissions.decorator';

// Generated CRUD, not a real port yet: gated by the global JwtAuthGuard and
// permission-checked against the 'tenants' catalog resource, but the service
// underneath is plain Prisma CRUD. This model has no tenantId of its own, so there is
// nothing to scope by here — note that a TENANT_OWNER short-circuits PermissionsGuard
// entirely, so @Permissions alone does not keep one out of a platform-level resource.
@ApiTags('tenants')
@ApiBearerAuth('bearer')
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
