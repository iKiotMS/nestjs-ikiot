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
import { PromotionLogService } from './promotion-logs.service';
import { CreatePromotionLogDto } from './dto/create-promotion-logs.dto';
import { UpdatePromotionLogDto } from './dto/update-promotion-logs.dto';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Permissions } from '../../common/decorators/permissions.decorator';
import {
  requireTenantId,
  resolveTenantScope,
} from '../../common/utils/tenant-scope';
import type { AuthUser } from '../../common/types/auth-user.type';

// Generated CRUD, not a real port yet: gated by the global JwtAuthGuard, scoped to the
// caller's tenant and permission-checked against the 'promotions' catalog resource — but
// the service underneath is plain Prisma CRUD, not the real business logic.
@ApiTags('promotion-logs')
@ApiBearerAuth('bearer')
@Controller('promotion-logs')
export class PromotionLogController {
  constructor(private readonly service: PromotionLogService) {}

  @Permissions('promotions', 'read')
  @Get()
  findAll(@CurrentUser() user: AuthUser, @Query('tenantId') tenantId?: string) {
    return this.service.findAll(resolveTenantScope(user, tenantId));
  }

  @Permissions('promotions', 'read')
  @Get(':id')
  findOne(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Query('tenantId') tenantId?: string,
  ) {
    return this.service.findOne(resolveTenantScope(user, tenantId), id);
  }

  @Permissions('promotions', 'create')
  @Post()
  create(
    @CurrentUser() user: AuthUser,
    @Body() dto: CreatePromotionLogDto,
    @Query('tenantId') tenantId?: string,
  ) {
    return this.service.create(
      requireTenantId(user, tenantId),
      user.userId,
      dto,
    );
  }

  @Permissions('promotions', 'update')
  @Patch(':id')
  update(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() dto: UpdatePromotionLogDto,
    @Query('tenantId') tenantId?: string,
  ) {
    return this.service.update(resolveTenantScope(user, tenantId), id, dto);
  }

  @Permissions('promotions', 'delete')
  @Delete(':id')
  remove(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Query('tenantId') tenantId?: string,
  ) {
    return this.service.remove(resolveTenantScope(user, tenantId), id);
  }
}
