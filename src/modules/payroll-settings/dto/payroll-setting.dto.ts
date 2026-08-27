import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  Max,
  Min,
} from 'class-validator';

/** Only MONTHLY exists. Kept as a field because the old schema had it and payroll cycles
 *  are the kind of thing that grows a second value later. */
export const PAYROLL_CYCLES = ['MONTHLY'];

export class CreatePayrollSettingDto {
  @IsOptional()
  @IsIn(PAYROLL_CYCLES, { message: 'Chu kỳ lương không hợp lệ' })
  cycle?: string;

  // `periodStartDay` is deliberately absent, and the column keeps its default of 1.
  //
  // iKiotMS-BE had the same column, passed it into `buildMonthlyPeriodRange`, and that
  // function ignored it — a payroll period is always the calendar month. That was not an
  // oversight: both old DTOs rejected the field outright with "Không hỗ trợ ngày bắt đầu
  // kỳ lương tùy chỉnh", so the feature was consistently refused at the edge. Only a stale
  // comment in `generatePayrollPeriod` claimed a 26th-to-25th period. Leaving it out of the
  // DTO says the same thing the old validators did, one layer earlier.

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  approveAfterPeriodEndDays?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  payAfterPeriodEndDays?: number;

  @IsOptional()
  @IsBoolean()
  autoGenerate?: boolean;

  /** The divisor a FIXED salary is prorated by. 26 is the Vietnamese convention. */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(31)
  standardWorkingDays?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(24)
  standardWorkingHoursPerDay?: number;

  /** Day-of-week numbers, 0 = Sunday. */
  @IsOptional()
  @ArrayMaxSize(7)
  @IsInt({ each: true })
  @Min(0, { each: true })
  @Max(6, { each: true })
  weekendDays?: number[];

  /**
   * Minutes of lateness forgiven. All-or-nothing: past it the whole lateness counts.
   * Read by attendance (when storing `lateMinutes`) and by payroll, so it lives here.
   */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(240)
  lateGraceMinutes?: number;

  @IsOptional()
  @IsIn(['ACTIVE', 'INACTIVE'])
  status?: string;
}

export class UpdatePayrollSettingDto extends CreatePayrollSettingDto {}
