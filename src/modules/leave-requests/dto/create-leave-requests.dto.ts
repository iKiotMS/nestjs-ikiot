import { IsDateString, IsNumber, IsOptional, IsString } from 'class-validator';

export class CreateLeaveRequestDto {
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
