import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { AIChatHistoryService } from './ai-chat-histories.service';
import { CreateAIChatHistoryDto } from './dto/create-ai-chat-histories.dto';
import { UpdateAIChatHistoryDto } from './dto/update-ai-chat-histories.dto';

// TODO: apply JwtAuthGuard + PermissionsGuard once auth/tenant are ported (see migration plan, group A).
@Controller('ai-chat-histories')
export class AIChatHistoryController {
  constructor(private readonly service: AIChatHistoryService) {}

  @Get()
  findAll(@Query('tenantId') tenantId?: string) {
    return this.service.findAll(tenantId);
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.service.findOne(id);
  }

  @Post()
  create(@Body() dto: CreateAIChatHistoryDto) {
    return this.service.create(dto);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdateAIChatHistoryDto) {
    return this.service.update(id, dto);
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.service.remove(id);
  }
}
