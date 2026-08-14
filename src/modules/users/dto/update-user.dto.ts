import { IsIn, IsOptional, IsUUID } from 'class-validator';

// Deliberately excludes password/phoneNumber (self-service only, via /auth) and
// systemRole (a STAFF account can never be promoted to TENANT_OWNER/ADMIN through this
// endpoint — there is exactly one TENANT_OWNER per tenant, set at registration).
export class UpdateUserDto {
  @IsOptional()
  @IsUUID()
  roleId?: string;

  @IsOptional()
  @IsUUID()
  branchId?: string;

  @IsOptional()
  @IsUUID()
  warehouseId?: string;

  @IsOptional()
  @IsIn(['ACTIVE', 'INACTIVE', 'SUSPENDED'])
  status?: string;
}
