import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { CashDrawerSessionService } from './cash-drawer-sessions.service';
import { CreateCashDrawerSessionDto } from './dto/create-cash-drawer-sessions.dto';
import { UpdateCashDrawerSessionDto } from './dto/update-cash-drawer-sessions.dto';

// TODO: apply JwtAuthGuard + PermissionsGuard once auth/tenant are ported (see migration plan, group A).
@ApiTags('cash-drawer-sessions')
@Controller('cash-drawer-sessions')
export class CashDrawerSessionController {
  constructor(private readonly service: CashDrawerSessionService) {}

  @Get()
  findAll(@Query('tenantId') tenantId?: string) {
    return this.service.findAll(tenantId);
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.service.findOne(id);
  }

  @Post()
  create(@Body() dto: CreateCashDrawerSessionDto) {
    return this.service.create(dto);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdateCashDrawerSessionDto) {
    return this.service.update(id, dto);
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.service.remove(id);
  }
}
