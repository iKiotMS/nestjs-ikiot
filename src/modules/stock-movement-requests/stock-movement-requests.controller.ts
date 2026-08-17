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
import { StockMovementRequestService } from './stock-movement-requests.service';
import { CreateStockMovementRequestDto } from './dto/create-stock-movement-requests.dto';
import { UpdateStockMovementRequestDto } from './dto/update-stock-movement-requests.dto';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Permissions } from '../../common/decorators/permissions.decorator';
import {
  requireTenantId,
  resolveTenantScope,
} from '../../common/utils/tenant-scope';
import type { AuthUser } from '../../common/types/auth-user.type';

// Generated CRUD, not a real port yet: gated by the global JwtAuthGuard, scoped to the
// caller's tenant and permission-checked against the 'stock_movement' catalog resource — but
// the service underneath is plain Prisma CRUD, not the real business logic.
@ApiTags('stock-movement-requests')
@ApiBearerAuth('bearer')
@Controller('stock-movement-requests')
export class StockMovementRequestController {
  constructor(private readonly service: StockMovementRequestService) {}

  @Permissions('stock_movement', 'read')
  @Get()
  findAll(@CurrentUser() user: AuthUser, @Query('tenantId') tenantId?: string) {
    return this.service.findAll(resolveTenantScope(user, tenantId));
  }

  @Permissions('stock_movement', 'read')
  @Get(':id')
  findOne(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Query('tenantId') tenantId?: string,
  ) {
    return this.service.findOne(resolveTenantScope(user, tenantId), id);
  }

  @Permissions('stock_movement', 'create')
  @Post()
  create(
    @CurrentUser() user: AuthUser,
    @Body() dto: CreateStockMovementRequestDto,
    @Query('tenantId') tenantId?: string,
  ) {
    return this.service.create(
      requireTenantId(user, tenantId),
      user.userId,
      dto,
    );
  }

  @Permissions('stock_movement', 'update')
  @Patch(':id')
  update(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() dto: UpdateStockMovementRequestDto,
    @Query('tenantId') tenantId?: string,
  ) {
    return this.service.update(resolveTenantScope(user, tenantId), id, dto);
  }

  @Permissions('stock_movement', 'delete')
  @Delete(':id')
  remove(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Query('tenantId') tenantId?: string,
  ) {
    return this.service.remove(resolveTenantScope(user, tenantId), id);
  }
}
