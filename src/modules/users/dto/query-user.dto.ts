import { Transform } from 'class-transformer';
import { IsIn, IsOptional, IsString, IsUUID } from 'class-validator';
import { PaginationQueryDto } from '../../../common/dto/pagination-query.dto';
import { SETTABLE_USER_STATUSES } from '../../../common/constants/user-status';

/**
 * Ported from the filters iKiotMS-BE's `getStaffList` accepted.
 *
 * Two renames, for consistency with every other ported list endpoint in this codebase:
 * `recordPerPage` → `limit` (via PaginationQueryDto) and `keyword` → `search`. The old
 * `role` filter took a value from the fixed role enum; roles are tenant-defined rows now,
 * so it is `roleId`.
 */
export class QueryUserDto extends PaginationQueryDto {
  /** Partial, case-insensitive match on email, phone number, first or last name. */
  @IsOptional()
  @IsString()
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  search?: string;

  // DELETED is absent on purpose: deleted staff are anonymised and never listed.
  @IsOptional()
  @IsIn(SETTABLE_USER_STATUSES)
  status?: string;

  @IsOptional()
  @IsUUID()
  roleId?: string;

  @IsOptional()
  @IsUUID()
  branchId?: string;

  @IsOptional()
  @IsUUID()
  warehouseId?: string;
}
