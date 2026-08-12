import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateAuditLogDto } from './dto/create-audit-logs.dto';
import { UpdateAuditLogDto } from './dto/update-audit-logs.dto';

@Injectable()
export class AuditLogService {
  constructor(private readonly prisma: PrismaService) {}

  findAll(tenantId?: string) {
    return this.prisma.auditLog.findMany(tenantId ? { where: { tenantId } } : undefined);
  }

  findOne(id: string) {
    return this.prisma.auditLog.findUniqueOrThrow({ where: { id } });
  }

  create(data: CreateAuditLogDto) {
    return this.prisma.auditLog.create({ data: data as any });
  }

  update(id: string, data: UpdateAuditLogDto) {
    return this.prisma.auditLog.update({ where: { id }, data: data as any });
  }

  remove(id: string) {
    return this.prisma.auditLog.delete({ where: { id } });
  }
}
