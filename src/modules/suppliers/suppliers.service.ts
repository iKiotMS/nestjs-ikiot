import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateSupplierDto } from './dto/create-suppliers.dto';
import { UpdateSupplierDto } from './dto/update-suppliers.dto';

@Injectable()
export class SupplierService {
  constructor(private readonly prisma: PrismaService) {}

  findAll(tenantId?: string) {
    return this.prisma.supplier.findMany(tenantId ? { where: { tenantId } } : undefined);
  }

  findOne(id: string) {
    return this.prisma.supplier.findUniqueOrThrow({ where: { id } });
  }

  create(data: CreateSupplierDto) {
    return this.prisma.supplier.create({ data: data as any });
  }

  update(id: string, data: UpdateSupplierDto) {
    return this.prisma.supplier.update({ where: { id }, data: data as any });
  }

  remove(id: string) {
    return this.prisma.supplier.delete({ where: { id } });
  }
}
