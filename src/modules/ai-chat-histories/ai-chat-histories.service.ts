import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateAIChatHistoryDto } from './dto/create-ai-chat-histories.dto';
import { UpdateAIChatHistoryDto } from './dto/update-ai-chat-histories.dto';

@Injectable()
export class AIChatHistoryService {
  constructor(private readonly prisma: PrismaService) {}

  findAll(tenantId?: string) {
    return this.prisma.aIChatHistory.findMany(tenantId ? { where: { tenantId } } : undefined);
  }

  findOne(id: string) {
    return this.prisma.aIChatHistory.findUniqueOrThrow({ where: { id } });
  }

  create(data: CreateAIChatHistoryDto) {
    return this.prisma.aIChatHistory.create({ data: data as any });
  }

  update(id: string, data: UpdateAIChatHistoryDto) {
    return this.prisma.aIChatHistory.update({ where: { id }, data: data as any });
  }

  remove(id: string) {
    return this.prisma.aIChatHistory.delete({ where: { id } });
  }
}
