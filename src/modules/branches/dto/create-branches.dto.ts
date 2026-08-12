import { IsArray, IsInt, IsNumber, IsOptional, IsString } from 'class-validator';

export class CreateBranchDto {
  @IsString()
  tenantId: string;

  @IsString()
  name: string;

  @IsString()
  status: string;

  @IsOptional()
  @IsString()
  address?: string;

  @IsArray()
  @IsString({ each: true })
  phoneNumber: string[];

  @IsOptional()
  @IsString()
  email?: string;

  @IsOptional()
  @IsString()
  managerId?: string;

  @IsOptional()
  @IsNumber()
  attendanceLatitude?: number;

  @IsOptional()
  @IsNumber()
  attendanceLongitude?: number;

  @IsOptional()
  @IsInt()
  attendanceAllowedRadiusMeters?: number;

  @IsOptional()
  @IsInt()
  attendanceMaxAccuracyMeters?: number;
}
