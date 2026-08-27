import { Transform, Type } from 'class-transformer';
import {
  IsIn,
  IsInt,
  IsISO8601,
  IsOptional,
  IsString,
  Max,
  Min,
  Validate,
  ValidationArguments,
  ValidatorConstraint,
  ValidatorConstraintInterface,
} from 'class-validator';
import { CASHFLOW_PREFIXES } from '../../../common/utils/reference-generator';
import { PAYMENT_METHODS } from '../../../common/constants/payment-method';
import {
  DEFAULT_LOW_STOCK_THRESHOLD,
  FLOW_TYPES,
  GROUP_BY_VALUES,
  GroupBy,
  TOP_PRODUCTS_SORTS,
  TopProductsSort,
} from '../stats.constants';
import { resolveRange, type DateRange } from '../stats-math';

const upper = () =>
  Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.toUpperCase() : value,
  );

/**
 * `fromDate` must not come after `toDate` — a range validator rather than a field one,
 * because neither bound is wrong on its own.
 */
@ValidatorConstraint({ name: 'rangeIsForwards' })
class RangeIsForwards implements ValidatorConstraintInterface {
  validate(_: unknown, args: ValidationArguments): boolean {
    const { fromDate, toDate } = args.object as StatsQueryDto;
    if (!fromDate || !toDate) return true;
    return new Date(fromDate).getTime() <= new Date(toDate).getTime();
  }
  defaultMessage(): string {
    return 'fromDate phải trước toDate';
  }
}

/**
 * The query every dashboard endpoint shares. Ported from iKiotMS-BE's `StatsQueryDTO`, which
 * was one class covering all nine routes; here it is split so each route documents only the
 * parameters it actually reads — the old single DTO is why `?sortBy=` silently did nothing
 * on `/stats/overview`.
 *
 * **Both bounds accept either a full ISO timestamp or a bare `YYYY-MM-DD`**, and a bare date
 * means the whole local day: `fromDate` becomes its midnight, `toDate` its last millisecond.
 * Truncating `toDate` to midnight instead would silently drop a whole day of sales — which
 * is why the range is resolved by `resolveRange` rather than by `new Date()` at the call
 * site.
 */
export class StatsQueryDto {
  @IsOptional()
  @IsISO8601({ strict: false }, { message: 'fromDate không hợp lệ' })
  @Validate(RangeIsForwards)
  fromDate?: string;

  @IsOptional()
  @IsISO8601({ strict: false }, { message: 'toDate không hợp lệ' })
  toDate?: string;

  @IsOptional()
  @IsString()
  branchId?: string;

  /** Resolved defaults — call this instead of reading the two raw strings. */
  range(): DateRange {
    return resolveRange(this.fromDate, this.toDate);
  }
}

export class RevenueSeriesQueryDto extends StatsQueryDto {
  @IsOptional()
  @IsIn(GROUP_BY_VALUES, {
    message: `groupBy phải là ${GROUP_BY_VALUES.join(' hoặc ')}`,
  })
  groupBy?: GroupBy = GroupBy.DAY;
}

/** Cashflow endpoints add a warehouse filter — money moves at warehouses too, sales don't. */
export class CashflowQueryDto extends StatsQueryDto {
  @IsOptional()
  @IsString()
  warehouseId?: string;

  @IsOptional()
  @upper()
  @IsIn(CASHFLOW_PREFIXES, {
    message: `flow phải là ${CASHFLOW_PREFIXES.join(', ')}`,
  })
  flow?: string;

  @IsOptional()
  @upper()
  @IsIn(FLOW_TYPES, {
    message: `flowType phải là ${FLOW_TYPES.join(' hoặc ')}`,
  })
  flowType?: string;
}

export class CashflowListQueryDto extends CashflowQueryDto {
  @IsOptional()
  @upper()
  @IsIn(PAYMENT_METHODS, {
    message: `paymentMethod phải là ${PAYMENT_METHODS.join(', ')}`,
  })
  paymentMethod?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page: number = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit: number = 10;
}

export class TopProductsQueryDto extends StatsQueryDto {
  @IsOptional()
  @IsIn(TOP_PRODUCTS_SORTS, {
    message: `sortBy phải là ${TOP_PRODUCTS_SORTS.join(' hoặc ')}`,
  })
  sortBy?: string = TopProductsSort.QUANTITY;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit: number = 10;
}

/** No date range: stock is a level, not a flow — it is only ever "right now". */
export class InventoryStatsQueryDto {
  @IsOptional()
  @IsString()
  branchId?: string;

  @IsOptional()
  @IsString()
  warehouseId?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  lowStockThreshold: number = DEFAULT_LOW_STOCK_THRESHOLD;
}

/** The platform overview looks across tenants, so it has no location filter at all. */
export class AdminOverviewQueryDto {
  @IsOptional()
  @IsISO8601({ strict: false }, { message: 'fromDate không hợp lệ' })
  fromDate?: string;

  @IsOptional()
  @IsISO8601({ strict: false }, { message: 'toDate không hợp lệ' })
  toDate?: string;

  @IsOptional()
  @IsIn(GROUP_BY_VALUES, {
    message: `groupBy phải là ${GROUP_BY_VALUES.join(' hoặc ')}`,
  })
  groupBy?: GroupBy = GroupBy.DAY;

  range(): DateRange {
    return resolveRange(this.fromDate, this.toDate);
  }
}
