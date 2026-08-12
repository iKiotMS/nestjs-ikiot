import { IsNumber, IsOptional, IsString } from 'class-validator';

export class CreatePaysheetDto {
  @IsString()
  tenantId: string;

  @IsOptional()
  @IsString()
  createdById?: string;

  @IsString()
  name: string;

  @IsString()
  status: string;

  @IsOptional()
  @IsString()
  basicPayType?: string;

  @IsOptional()
  @IsNumber()
  basicPayAmountPerShift?: number;

  @IsOptional()
  @IsNumber()
  basicPaySalaryPerPeriod?: number;

  @IsOptional()
  @IsNumber()
  basicPayStandardWorkingDaySalary?: number;

  @IsNumber()
  basicPayRateWeekend: number;

  @IsNumber()
  basicPayRatePublicHoliday: number;

  @IsNumber()
  overtimeNormalDay: number;

  @IsNumber()
  overtimeWeekend: number;

  @IsNumber()
  overtimePublicHoliday: number;
}
