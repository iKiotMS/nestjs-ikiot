import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { CashFlowService } from './cash-flows.service';
import { CreateCashFlowDto } from './dto/create-cash-flows.dto';
import { UpdateCashFlowDto } from './dto/update-cash-flows.dto';

// TODO: apply JwtAuthGuard + PermissionsGuard once auth/tenant are ported (see migration plan, group A).
@Controller('cash-flows')
export class CashFlowController {
  constructor(private readonly service: CashFlowService) {}

  @Get()
  findAll(@Query('tenantId') tenantId?: string) {
    return this.service.findAll(tenantId);
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.service.findOne(id);
  }

  @Post()
  create(@Body() dto: CreateCashFlowDto) {
    return this.service.create(dto);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdateCashFlowDto) {
    return this.service.update(id, dto);
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.service.remove(id);
  }
}
