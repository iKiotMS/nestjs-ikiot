import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateTicketDto } from './dto/create-tickets.dto';
import { UpdateTicketDto } from './dto/update-tickets.dto';

@Injectable()
export class TicketService {
  constructor(private readonly prisma: PrismaService) {}

  findAll(tenantId?: string) {
    return this.prisma.ticket.findMany({
      where: { ...(tenantId ? { tenantId } : {}) },
    });
  }

  // findFirst + explicit throw rather than findFirstOrThrow: Prisma's own not-found error
  // isn't an HttpException, so Nest turns it into a 500. A row in another tenant must be
  // indistinguishable from one that doesn't exist — 404 either way, never 403.
  async findOne(tenantId: string | undefined, id: string) {
    const found = await this.prisma.ticket.findFirst({
      where: { id, ...(tenantId ? { tenantId } : {}) },
    });
    if (!found) throw new NotFoundException('Ticket not found');
    return found;
  }

  create(tenantId: string, actorId: string, data: CreateTicketDto) {
    return this.prisma.ticket.create({
      data: { ...data, tenantId, userId: actorId },
    });
  }

  async update(
    tenantId: string | undefined,
    id: string,
    data: UpdateTicketDto,
  ) {
    await this.findOne(tenantId, id);
    return this.prisma.ticket.update({ where: { id }, data });
  }

  async remove(tenantId: string | undefined, id: string) {
    await this.findOne(tenantId, id);
    return this.prisma.ticket.delete({ where: { id } });
  }
}
