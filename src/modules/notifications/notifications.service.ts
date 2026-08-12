import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateNotificationDto } from './dto/create-notifications.dto';
import { UpdateNotificationDto } from './dto/update-notifications.dto';

@Injectable()
export class NotificationService {
  constructor(private readonly prisma: PrismaService) {}

  findAll(tenantId?: string) {
    return this.prisma.notification.findMany(tenantId ? { where: { tenantId } } : undefined);
  }

  findOne(id: string) {
    return this.prisma.notification.findUniqueOrThrow({ where: { id } });
  }

  create(data: CreateNotificationDto) {
    return this.prisma.notification.create({ data: data as any });
  }

  update(id: string, data: UpdateNotificationDto) {
    return this.prisma.notification.update({ where: { id }, data: data as any });
  }

  remove(id: string) {
    return this.prisma.notification.delete({ where: { id } });
  }
}
