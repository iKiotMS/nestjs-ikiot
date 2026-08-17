import { IsDateString, IsNumber, IsOptional, IsString } from 'class-validator';

export class CreateCashDrawerSessionDto {
  @IsString()
  branchId: string;

  @IsDateString()
  businessDate: string;

  @IsString()
  status: string;

  @IsNumber()
  openingAmount: number;

  @IsString()
  openedById: string;

  @IsString()
  currentStaffId: string;

  @IsOptional()
  @IsNumber()
  finalLogAmount?: number;

  @IsOptional()
  @IsString()
  finalLogManagerId?: string;

  @IsOptional()
  @IsString()
  finalLogNote?: string;
}
