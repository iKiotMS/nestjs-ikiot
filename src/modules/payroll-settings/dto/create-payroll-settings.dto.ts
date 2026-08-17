import { IsArray, IsBoolean, IsInt, IsString } from 'class-validator';

export class CreatePayrollSettingDto {
  @IsString()
  cycle: string;

  @IsInt()
  periodStartDay: number;

  @IsInt()
  approveAfterPeriodEndDays: number;

  @IsInt()
  payAfterPeriodEndDays: number;

  @IsBoolean()
  autoGenerate: boolean;

  @IsInt()
  standardWorkingDays: number;

  @IsInt()
  standardWorkingHoursPerDay: number;

  @IsArray()
  @IsInt({ each: true })
  weekendDays: number[];

  @IsInt()
  lateGraceMinutes: number;

  @IsString()
  status: string;
}
