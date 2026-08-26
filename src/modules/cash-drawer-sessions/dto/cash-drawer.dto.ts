import { Transform, Type } from 'class-transformer';
import {
  IsDateString,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  Min,
} from 'class-validator';
import { PaginationQueryDto } from '../../../common/dto/pagination-query.dto';
import {
  CASH_DRAWER_STATUSES,
  SHIFT_LOG_TYPES,
  ShiftLogType,
} from '../cash-drawer.constants';

/**
 * Amounts here are whole đồng — the old DTOs all demanded integers and there is no smaller
 * unit in circulation, so a till count with decimals is a typo.
 */
export class OpenCashDrawerDto {
  /**
   * Optional for someone posted at a branch — theirs is the only one they could mean.
   * Required for an owner, who has no branch of their own.
   */
  @IsOptional()
  @IsUUID()
  branchId?: string;

  /** Who takes the drawer first. Must be active staff at that branch. */
  @IsUUID()
  staffId: string;

  @Type(() => Number)
  @IsInt({ message: 'Số tiền đầu ca phải là số nguyên' })
  @Min(0, { message: 'Số tiền đầu ca không được âm' })
  openingAmount: number;
}

/** Ported from ShiftLogDTO. */
export class SubmitShiftLogDto {
  @IsIn(SHIFT_LOG_TYPES, {
    message: `type phải là ${SHIFT_LOG_TYPES.join(' hoặc ')}`,
  })
  type: string = ShiftLogType.END;

  /** What was counted in the drawer at that moment. */
  @Type(() => Number)
  @IsInt({ message: 'Số tiền phải là số nguyên' })
  @Min(0, { message: 'Số tiền không được âm' })
  amount: number;

  /**
   * Only on an `END`, and only when handing over to somebody: the drawer stays open and
   * becomes theirs. Rejected on a `START`, where it would mean nothing.
   */
  // "Not on a START" is checked in the service rather than with a second @ValidateIf:
  // stacking two of them on one property makes which rule wins depend on decorator order.
  @IsOptional()
  @IsUUID()
  nextStaffId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  note?: string;
}

/** Ported from FinalizeCashDrawerDTO. */
export class FinalizeCashDrawerDto {
  /** What the manager actually counted when closing the day. */
  @Type(() => Number)
  @IsInt({ message: 'Số tiền cuối ca phải là số nguyên' })
  @Min(0, { message: 'Số tiền cuối ca không được âm' })
  finalAmount: number;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  note?: string;
}

/** Ported from CashDrawerQueryDTO (`YYYY-MM-DD` dates, as before). */
export class QueryCashDrawerDto extends PaginationQueryDto {
  @IsOptional()
  @IsUUID()
  branchId?: string;

  @IsOptional()
  @IsIn(CASH_DRAWER_STATUSES)
  status?: string;

  @IsOptional()
  @IsDateString()
  fromDate?: string;

  @IsOptional()
  @IsDateString()
  toDate?: string;
}

/** `GET /cash-drawer-sessions/current` takes only the branch. */
export class CurrentCashDrawerDto {
  @IsOptional()
  @IsUUID()
  branchId?: string;
}
