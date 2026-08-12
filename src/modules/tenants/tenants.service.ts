import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateTenantDto } from './dto/create-tenants.dto';
import { UpdateTenantDto } from './dto/update-tenants.dto';

@Injectable()
export class TenantService {
  constructor(private readonly prisma: PrismaService) {}

  findAll() {
    return this.prisma.tenant.findMany(undefined);
  }

  findOne(id: string) {
    return this.prisma.tenant.findUniqueOrThrow({ where: { id } });
  }

  create(data: CreateTenantDto) {
    return this.prisma.tenant.create({ data: data as any });
  }

  update(id: string, data: UpdateTenantDto) {
    return this.prisma.tenant.update({ where: { id }, data: data as any });
  }

  remove(id: string) {
    return this.prisma.tenant.delete({ where: { id } });
  }
}
