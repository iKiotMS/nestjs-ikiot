import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { SubscriptionInvoiceService } from './subscription-invoices.service';
import { CreateSubscriptionInvoiceDto } from './dto/create-subscription-invoices.dto';
import { UpdateSubscriptionInvoiceDto } from './dto/update-subscription-invoices.dto';

// TODO: apply JwtAuthGuard + PermissionsGuard once auth/tenant are ported (see migration plan, group A).
@Controller('subscription-invoices')
export class SubscriptionInvoiceController {
  constructor(private readonly service: SubscriptionInvoiceService) {}

  @Get()
  findAll(@Query('tenantId') tenantId?: string) {
    return this.service.findAll(tenantId);
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.service.findOne(id);
  }

  @Post()
  create(@Body() dto: CreateSubscriptionInvoiceDto) {
    return this.service.create(dto);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdateSubscriptionInvoiceDto) {
    return this.service.update(id, dto);
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.service.remove(id);
  }
}
