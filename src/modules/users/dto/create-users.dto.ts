import { IsDateString, IsInt, IsOptional, IsString } from 'class-validator';

export class CreateUserDto {
  @IsString()
  tenantId: string;

  @IsOptional()
  @IsString()
  email?: string;

  @IsOptional()
  @IsString()
  password?: string;

  @IsString()
  phoneNumber: string;

  @IsString()
  role: string;

  @IsString()
  status: string;

  @IsOptional()
  @IsString()
  createdById?: string;

  @IsOptional()
  @IsString()
  deletedById?: string;

  @IsOptional()
  @IsDateString()
  deletedAt?: string;

  @IsOptional()
  @IsString()
  deletionReason?: string;

  @IsOptional()
  @IsDateString()
  lastLogin?: string;

  @IsOptional()
  @IsDateString()
  hireDate?: string;

  @IsOptional()
  @IsString()
  paysheetId?: string;

  @IsOptional()
  @IsString()
  warehouseId?: string;

  @IsOptional()
  @IsString()
  branchId?: string;

  @IsOptional()
  @IsString()
  accountNote?: string;

  @IsOptional()
  @IsString()
  profileFirstName?: string;

  @IsOptional()
  @IsString()
  profileLastName?: string;

  @IsOptional()
  @IsString()
  profileAvatarUrl?: string;

  @IsOptional()
  @IsDateString()
  profileDob?: string;

  @IsOptional()
  @IsString()
  profileTaxNumber?: string;

  @IsOptional()
  @IsString()
  profileIdentificationId?: string;

  @IsOptional()
  @IsString()
  profileAddress?: string;

  @IsOptional()
  @IsString()
  profileGender?: string;

  @IsInt()
  leaveBalanceAnnualDays: number;

  @IsInt()
  leaveBalanceRemainingDays: number;
}
