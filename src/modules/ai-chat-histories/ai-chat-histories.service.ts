import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateAIChatHistoryDto } from './dto/create-ai-chat-histories.dto';
import { UpdateAIChatHistoryDto } from './dto/update-ai-chat-histories.dto';

@Injectable()
export class AIChatHistoryService {
  constructor(private readonly prisma: PrismaService) {}

  findAll(tenantId?: string) {
    return this.prisma.aIChatHistory.findMany({
      where: { ...(tenantId ? { tenantId } : {}) },
    });
  }

  // findFirst + explicit throw rather than findFirstOrThrow: Prisma's own not-found error
  // isn't an HttpException, so Nest turns it into a 500. A row in another tenant must be
  // indistinguishable from one that doesn't exist — 404 either way, never 403.
  async findOne(tenantId: string | undefined, id: string) {
    const found = await this.prisma.aIChatHistory.findFirst({
      where: { id, ...(tenantId ? { tenantId } : {}) },
    });
    if (!found) throw new NotFoundException('AIChatHistory not found');
    return found;
  }

  create(tenantId: string, actorId: string, data: CreateAIChatHistoryDto) {
    return this.prisma.aIChatHistory.create({
      data: { ...data, tenantId, userId: actorId },
    });
  }

  async update(
    tenantId: string | undefined,
    id: string,
    data: UpdateAIChatHistoryDto,
  ) {
    await this.findOne(tenantId, id);
    return this.prisma.aIChatHistory.update({ where: { id }, data });
  }

  async remove(tenantId: string | undefined, id: string) {
    await this.findOne(tenantId, id);
    return this.prisma.aIChatHistory.delete({ where: { id } });
  }
}
