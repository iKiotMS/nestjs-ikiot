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
import { RolesService } from './roles.service';
import { CreateRoleDto } from './dto/create-role.dto';
import { UpdateRoleDto } from './dto/update-role.dto';
import { OwnerOrAdminGuard } from '../../common/guards/owner-or-admin.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { AuthUser } from '../../common/types/auth-user.type';

@ApiTags('roles')
@ApiBearerAuth('bearer')
@UseGuards(OwnerOrAdminGuard)
@Controller('roles')
export class RolesController {
  constructor(private readonly rolesService: RolesService) {}

  @Get()
  findAll(@CurrentUser() user: AuthUser) {
    return this.rolesService.findAll(user.tenantId!);
  }

  @Get('permission-catalog')
  permissionCatalog() {
    return this.rolesService.permissionCatalog();
  }

  @Get(':id')
  findOne(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.rolesService.findOne(user.tenantId!, id);
  }

  @Post()
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateRoleDto) {
    return this.rolesService.create(user.tenantId!, dto);
  }

  @Patch(':id')
  update(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() dto: UpdateRoleDto,
  ) {
    return this.rolesService.update(user.tenantId!, id, dto);
  }

  @Delete(':id')
  remove(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.rolesService.remove(user.tenantId!, id);
  }
}
