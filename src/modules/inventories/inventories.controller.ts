import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { InventoryService } from './inventories.service';
import { QueryInventoryDto } from './dto/query-inventory.dto';
import { AddProductToLocationDto } from './dto/add-product-to-location.dto';
import { UpdateMinStockDto } from './dto/update-min-stock.dto';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Permissions } from '../../common/decorators/permissions.decorator';
import { requireTenantId } from '../../common/utils/tenant-scope';
import type { AuthUser } from '../../common/types/auth-user.type';

/**
 * Real port of iKiotMS-BE's InventoryController. Path stays `/inventory` (singular), as
 * the old API and the catalog resource both spell it.
 *
 * Permissions differ from the old system in one place, deliberately: adding and removing a
 * product at a location used to be gated on `role in (TENANT_OWNER, WAREHOUSE_MANAGER)`,
 * and neither WAREHOUSE_MANAGER nor role-based gating exists any more. They are
 * `inventory:create` / `inventory:delete` now, which the tenant grants to whichever role
 * it wants — same substitution the branch/warehouse manager appointment made.
 */
@ApiTags('inventory')
@ApiBearerAuth('bearer')
@Controller('inventory')
export class InventoryController {
  constructor(private readonly service: InventoryService) {}

  @Permissions('inventory', 'read')
  @Get()
  findAll(@CurrentUser() user: AuthUser, @Query() query: QueryInventoryDto) {
    return this.service.findAll(requireTenantId(user), query);
  }

  @Permissions('inventory', 'update')
  @Patch(':id/min-stock')
  updateMinStock(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateMinStockDto,
  ) {
    return this.service.updateMinStock(requireTenantId(user), id, dto.minStock);
  }

  @Permissions('inventory', 'create')
  @Post()
  addProductToLocation(
    @CurrentUser() user: AuthUser,
    @Body() dto: AddProductToLocationDto,
  ) {
    return this.service.addProductToLocation(requireTenantId(user), dto);
  }

  @Permissions('inventory', 'delete')
  @Delete(':id')
  removeProductFromLocation(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.service.removeProductFromLocation(requireTenantId(user), id);
  }
}
