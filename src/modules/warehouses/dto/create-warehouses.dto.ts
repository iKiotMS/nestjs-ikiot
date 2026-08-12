import { IsInt, IsNumber, IsOptional, IsString } from 'class-validator';

export class CreateWarehouseDto {
  @IsString()
  tenantId: string;

  @IsString()
  name: string;

  @IsString()
  status: string;

  @IsOptional()
  @IsString()
  address?: string;

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
