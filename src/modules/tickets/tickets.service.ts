import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateTicketDto } from './dto/create-tickets.dto';
import { UpdateTicketDto } from './dto/update-tickets.dto';

@Injectable()
export class TicketService {
  constructor(private readonly prisma: PrismaService) {}

  findAll(tenantId?: string) {
    return this.prisma.ticket.findMany(tenantId ? { where: { tenantId } } : undefined);
  }

  findOne(id: string) {
    return this.prisma.ticket.findUniqueOrThrow({ where: { id } });
  }

  create(data: CreateTicketDto) {
    return this.prisma.ticket.create({ data: data as any });
  }

  update(id: string, data: UpdateTicketDto) {
    return this.prisma.ticket.update({ where: { id }, data: data as any });
  }

  remove(id: string) {
    return this.prisma.ticket.delete({ where: { id } });
  }
}
