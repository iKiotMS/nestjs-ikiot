import { IsDateString, IsInt, IsNumber, IsOptional, IsString } from 'class-validator';

export class CreateAttendanceDto {
  @IsString()
  tenantId: string;

  @IsString()
  userId: string;

  @IsString()
  scheduleId: string;

  @IsDateString()
  workDate: string;

  @IsOptional()
  @IsDateString()
  actualCheckinAt?: string;

  @IsOptional()
  @IsDateString()
  actualCheckoutAt?: string;

  @IsOptional()
  @IsInt()
  workedMinutes?: number;

  @IsOptional()
  @IsInt()
  overtimeMinute?: number;

  @IsOptional()
  @IsInt()
  lateMinutes?: number;

  @IsOptional()
  @IsString()
  status?: string;

  @IsOptional()
  @IsNumber()
  checkInLatitude?: number;

  @IsOptional()
  @IsNumber()
  checkInLongitude?: number;

  @IsOptional()
  @IsNumber()
  checkInAccuracy?: number;

  @IsOptional()
  @IsNumber()
  checkInDistance?: number;

  @IsOptional()
  @IsString()
  checkInVerificationStatus?: string;

  @IsOptional()
  @IsNumber()
  checkOutLatitude?: number;

  @IsOptional()
  @IsNumber()
  checkOutLongitude?: number;

  @IsOptional()
  @IsNumber()
  checkOutAccuracy?: number;

  @IsOptional()
  @IsNumber()
  checkOutDistance?: number;

  @IsOptional()
  @IsString()
  checkOutVerificationStatus?: string;

  @IsOptional()
  @IsString()
  manuallyEditedById?: string;

  @IsOptional()
  @IsDateString()
  manuallyEditedAt?: string;

  @IsOptional()
  @IsString()
  manualEditReason?: string;

  @IsOptional()
  @IsString()
  manuallyCreatedById?: string;

  @IsOptional()
  @IsDateString()
  manuallyCreatedAt?: string;

  @IsOptional()
  @IsString()
  manualCreationReason?: string;
}
