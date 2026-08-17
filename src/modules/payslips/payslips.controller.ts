import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { PayslipService } from './payslips.service';
import { CreatePayslipDto } from './dto/create-payslips.dto';
import { UpdatePayslipDto } from './dto/update-payslips.dto';

// TODO: apply JwtAuthGuard + PermissionsGuard once auth/tenant are ported (see migration plan, group A).
@ApiTags('payslips')
@Controller('payslips')
export class PayslipController {
  constructor(private readonly service: PayslipService) {}

  @Get()
  findAll(@Query('tenantId') tenantId?: string) {
    return this.service.findAll(tenantId);
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.service.findOne(id);
  }

  @Post()
  create(@Body() dto: CreatePayslipDto) {
    return this.service.create(dto);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdatePayslipDto) {
    return this.service.update(id, dto);
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.service.remove(id);
  }
}
