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
import { ProductService } from './products.service';
import { CreateProductDto } from './dto/create-products.dto';
import { UpdateProductDto } from './dto/update-products.dto';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Permissions } from '../../common/decorators/permissions.decorator';
import {
  requireTenantId,
  resolveTenantScope,
} from '../../common/utils/tenant-scope';
import type { AuthUser } from '../../common/types/auth-user.type';

// Generated CRUD, not a real port yet: gated by the global JwtAuthGuard, scoped to the
// caller's tenant and permission-checked against the 'products' catalog resource — but
// the service underneath is plain Prisma CRUD, not the real business logic.
@ApiTags('products')
@ApiBearerAuth('bearer')
@Controller('products')
export class ProductController {
  constructor(private readonly service: ProductService) {}

  @Permissions('products', 'read')
  @Get()
  findAll(@CurrentUser() user: AuthUser, @Query('tenantId') tenantId?: string) {
    return this.service.findAll(resolveTenantScope(user, tenantId));
  }

  @Permissions('products', 'read')
  @Get(':id')
  findOne(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Query('tenantId') tenantId?: string,
  ) {
    return this.service.findOne(resolveTenantScope(user, tenantId), id);
  }

  @Permissions('products', 'create')
  @Post()
  create(
    @CurrentUser() user: AuthUser,
    @Body() dto: CreateProductDto,
    @Query('tenantId') tenantId?: string,
  ) {
    return this.service.create(requireTenantId(user, tenantId), dto);
  }

  @Permissions('products', 'update')
  @Patch(':id')
  update(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() dto: UpdateProductDto,
    @Query('tenantId') tenantId?: string,
  ) {
    return this.service.update(resolveTenantScope(user, tenantId), id, dto);
  }

  @Permissions('products', 'delete')
  @Delete(':id')
  remove(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Query('tenantId') tenantId?: string,
  ) {
    return this.service.remove(resolveTenantScope(user, tenantId), id);
  }
}
