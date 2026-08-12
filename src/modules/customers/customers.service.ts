import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateCustomerDto } from './dto/create-customers.dto';
import { UpdateCustomerDto } from './dto/update-customers.dto';

@Injectable()
export class CustomerService {
  constructor(private readonly prisma: PrismaService) {}

  findAll(tenantId?: string) {
    return this.prisma.customer.findMany(tenantId ? { where: { tenantId } } : undefined);
  }

  findOne(id: string) {
    return this.prisma.customer.findUniqueOrThrow({ where: { id } });
  }

  create(data: CreateCustomerDto) {
    return this.prisma.customer.create({ data: data as any });
  }

  update(id: string, data: UpdateCustomerDto) {
    return this.prisma.customer.update({ where: { id }, data: data as any });
  }

  remove(id: string) {
    return this.prisma.customer.delete({ where: { id } });
  }
}
