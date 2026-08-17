import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { PayrollSettingService } from './payroll-settings.service';
import { CreatePayrollSettingDto } from './dto/create-payroll-settings.dto';
import { UpdatePayrollSettingDto } from './dto/update-payroll-settings.dto';

// TODO: apply JwtAuthGuard + PermissionsGuard once auth/tenant are ported (see migration plan, group A).
@ApiTags('payroll-settings')
@Controller('payroll-settings')
export class PayrollSettingController {
  constructor(private readonly service: PayrollSettingService) {}

  @Get()
  findAll(@Query('tenantId') tenantId?: string) {
    return this.service.findAll(tenantId);
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.service.findOne(id);
  }

  @Post()
  create(@Body() dto: CreatePayrollSettingDto) {
    return this.service.create(dto);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdatePayrollSettingDto) {
    return this.service.update(id, dto);
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.service.remove(id);
  }
}
