import { IsDateString, IsNumber, IsOptional, IsString } from 'class-validator';

export class CreateLeaveRequestDto {
  @IsString()
  tenantId: string;

  @IsString()
  userId: string;

  @IsOptional()
  @IsString()
  approvedById?: string;

  @IsNumber()
  paidLeaveDays: number;

  @IsNumber()
  unpaidLeaveDays: number;

  @IsOptional()
  @IsDateString()
  startDate?: string;

  @IsOptional()
  @IsDateString()
  endDate?: string;

  @IsOptional()
  @IsString()
  status?: string;

  @IsOptional()
  @IsString()
  reason?: string;

  @IsOptional()
  @IsString()
  reviewNote?: string;

  @IsOptional()
  @IsString()
  handoverToUserId?: string;
}
