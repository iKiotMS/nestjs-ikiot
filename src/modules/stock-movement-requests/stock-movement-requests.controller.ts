import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { StockMovementRequestService } from './stock-movement-requests.service';
import { CreateStockMovementRequestDto } from './dto/create-stock-movement-requests.dto';
import { UpdateStockMovementRequestDto } from './dto/update-stock-movement-requests.dto';

// TODO: apply JwtAuthGuard + PermissionsGuard once auth/tenant are ported (see migration plan, group A).
@Controller('stock-movement-requests')
export class StockMovementRequestController {
  constructor(private readonly service: StockMovementRequestService) {}

  @Get()
  findAll(@Query('tenantId') tenantId?: string) {
    return this.service.findAll(tenantId);
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.service.findOne(id);
  }

  @Post()
  create(@Body() dto: CreateStockMovementRequestDto) {
    return this.service.create(dto);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdateStockMovementRequestDto) {
    return this.service.update(id, dto);
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.service.remove(id);
  }
}
