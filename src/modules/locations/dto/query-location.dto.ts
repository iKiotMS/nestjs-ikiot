import { Transform } from 'class-transformer';
import { IsIn, IsOptional, IsString } from 'class-validator';
import { PaginationQueryDto } from '../../../common/dto/pagination-query.dto';
import { FILTERABLE_LOCATION_STATUSES } from '../../../common/constants/location-status';

/**
 * List filters shared by branches and warehouses. QueryBranchDto and QueryWarehouseDto
 * extend this so the two endpoints keep their own names in Swagger while the rules — which
 * statuses may be filtered on, how `search` is trimmed — exist once.
 */
export class QueryLocationDto extends PaginationQueryDto {
  /** Partial, case-insensitive match on the location name. */
  @IsOptional()
  @IsString()
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  search?: string;

  // Omitted means "everything that isn't soft-deleted" — passing status=DELETED is how you
  // look at the recycle bin, same as the old API.
  @IsOptional()
  @IsIn(FILTERABLE_LOCATION_STATUSES)
  status?: string;
}
