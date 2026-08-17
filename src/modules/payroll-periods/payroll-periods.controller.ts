import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { PayrollPeriodService } from './payroll-periods.service';
import { CreatePayrollPeriodDto } from './dto/create-payroll-periods.dto';
import { UpdatePayrollPeriodDto } from './dto/update-payroll-periods.dto';

// TODO: apply JwtAuthGuard + PermissionsGuard once auth/tenant are ported (see migration plan, group A).
@ApiTags('payroll-periods')
@Controller('payroll-periods')
export class PayrollPeriodController {
  constructor(private readonly service: PayrollPeriodService) {}

  @Get()
  findAll(@Query('tenantId') tenantId?: string) {
    return this.service.findAll(tenantId);
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.service.findOne(id);
  }

  @Post()
  create(@Body() dto: CreatePayrollPeriodDto) {
    return this.service.create(dto);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdatePayrollPeriodDto) {
    return this.service.update(id, dto);
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.service.remove(id);
  }
}
