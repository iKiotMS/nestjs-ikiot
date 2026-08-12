import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { ShiftTemplateService } from './shift-templates.service';
import { CreateShiftTemplateDto } from './dto/create-shift-templates.dto';
import { UpdateShiftTemplateDto } from './dto/update-shift-templates.dto';

// TODO: apply JwtAuthGuard + PermissionsGuard once auth/tenant are ported (see migration plan, group A).
@Controller('shift-templates')
export class ShiftTemplateController {
  constructor(private readonly service: ShiftTemplateService) {}

  @Get()
  findAll(@Query('tenantId') tenantId?: string) {
    return this.service.findAll(tenantId);
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.service.findOne(id);
  }

  @Post()
  create(@Body() dto: CreateShiftTemplateDto) {
    return this.service.create(dto);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdateShiftTemplateDto) {
    return this.service.update(id, dto);
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.service.remove(id);
  }
}
