import { IsDateString, IsNumber, IsOptional, IsString } from 'class-validator';

export class CreatePayslipDto {
  @IsString()
  userId: string;

  @IsOptional()
  @IsString()
  payrollPeriodId?: string;

  @IsOptional()
  @IsString()
  manageById?: string;

  @IsString()
  paysheetId: string;

  @IsString()
  status: string;

  @IsOptional()
  @IsDateString()
  periodStart?: string;

  @IsOptional()
  @IsDateString()
  periodEnd?: string;

  @IsOptional()
  @IsNumber()
  totalWorkedDays?: number;

  @IsOptional()
  @IsNumber()
  totalWorkedHours?: number;

  @IsNumber()
  basePay: number;

  @IsNumber()
  overtimePay: number;

  @IsNumber()
  paidLeaveDays: number;

  @IsNumber()
  unpaidLeaveDays: number;

  @IsNumber()
  paidLeavePay: number;

  @IsNumber()
  unpaidLeaveDeduction: number;

  @IsNumber()
  bonus: number;

  @IsNumber()
  allowance: number;

  @IsOptional()
  @IsNumber()
  grossSalary?: number;

  @IsNumber()
  deduction: number;

  @IsOptional()
  @IsNumber()
  netSalary?: number;

  @IsOptional()
  @IsString()
  note?: string;
}
