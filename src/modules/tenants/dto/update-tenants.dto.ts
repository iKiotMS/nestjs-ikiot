import { PartialType } from '@nestjs/mapped-types';
import { CreateTenantDto } from './create-tenants.dto';

export class UpdateTenantDto extends PartialType(CreateTenantDto) {}
