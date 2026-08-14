import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import * as bcrypt from 'bcryptjs';
import { PrismaService } from '../../prisma/prisma.service';
import { SystemRole } from '../../common/constants/system-role';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';

const BCRYPT_COST = 10;
const SELECT_SAFE = {
  id: true,
  tenantId: true,
  email: true,
  phoneNumber: true,
  systemRole: true,
  roleId: true,
  role: { select: { id: true, name: true } },
  status: true,
  branchId: true,
  warehouseId: true,
  profileFirstName: true,
  profileLastName: true,
  profileAvatarUrl: true,
  lastLogin: true,
  createdAt: true,
} as const;

@Injectable()
export class UserService {
  constructor(private readonly prisma: PrismaService) {}

  findAll(tenantId: string) {
    return this.prisma.user.findMany({
      where: { tenantId, status: { not: 'DELETED' } },
      select: SELECT_SAFE,
      orderBy: { createdAt: 'desc' },
    });
  }

  async findOne(tenantId: string, id: string) {
    const user = await this.prisma.user.findFirst({
      where: { id, tenantId },
      select: SELECT_SAFE,
    });
    if (!user) throw new NotFoundException('User not found');
    return user;
  }

  async create(tenantId: string, dto: CreateUserDto) {
    await this.assertRoleBelongsToTenant(tenantId, dto.roleId);
    await this.assertWorkplaceBelongsToTenant(
      tenantId,
      dto.branchId,
      dto.warehouseId,
    );

    const existingPhone = await this.prisma.user.findFirst({
      where: { phoneNumber: dto.phoneNumber },
    });
    if (existingPhone)
      throw new ConflictException('Phone number is already registered');

    const passwordHash = await bcrypt.hash(dto.password, BCRYPT_COST);
    const user = await this.prisma.user.create({
      data: {
        tenantId,
        phoneNumber: dto.phoneNumber,
        email: dto.email,
        password: passwordHash,
        systemRole: SystemRole.STAFF,
        roleId: dto.roleId,
        branchId: dto.branchId,
        warehouseId: dto.warehouseId,
        profileFirstName: dto.firstName,
        profileLastName: dto.lastName,
        status: 'ACTIVE',
      },
      select: SELECT_SAFE,
    });
    return user;
  }

  async update(tenantId: string, id: string, dto: UpdateUserDto) {
    const target = await this.findOne(tenantId, id);
    if (target.systemRole !== SystemRole.STAFF) {
      throw new BadRequestException(
        'Only STAFF accounts can be edited through this endpoint',
      );
    }
    if (dto.roleId) await this.assertRoleBelongsToTenant(tenantId, dto.roleId);
    await this.assertWorkplaceBelongsToTenant(
      tenantId,
      dto.branchId,
      dto.warehouseId,
    );

    return this.prisma.user.update({
      where: { id },
      data: {
        roleId: dto.roleId,
        branchId: dto.branchId,
        warehouseId: dto.warehouseId,
        status: dto.status,
      },
      select: SELECT_SAFE,
    });
  }

  async remove(tenantId: string, id: string) {
    const target = await this.findOne(tenantId, id);
    if (target.systemRole !== SystemRole.STAFF) {
      throw new BadRequestException(
        'Only STAFF accounts can be deleted through this endpoint',
      );
    }
    await this.prisma.user.update({
      where: { id },
      data: { status: 'DELETED', deletedAt: new Date() },
    });
    return { success: true };
  }

  private async assertRoleBelongsToTenant(tenantId: string, roleId: string) {
    const role = await this.prisma.role.findFirst({
      where: { id: roleId, tenantId },
    });
    if (!role)
      throw new BadRequestException('roleId does not belong to this tenant');
  }

  private async assertWorkplaceBelongsToTenant(
    tenantId: string,
    branchId?: string,
    warehouseId?: string,
  ) {
    if (branchId) {
      const branch = await this.prisma.branch.findFirst({
        where: { id: branchId, tenantId },
      });
      if (!branch)
        throw new BadRequestException(
          'branchId does not belong to this tenant',
        );
    }
    if (warehouseId) {
      const warehouse = await this.prisma.warehouse.findFirst({
        where: { id: warehouseId, tenantId },
      });
      if (!warehouse)
        throw new BadRequestException(
          'warehouseId does not belong to this tenant',
        );
    }
  }
}
