import { IntersectionType } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  Min,
  MinLength,
} from 'class-validator';
import { PaginationQueryDto } from '../../../common/dto/pagination-query.dto';
import { LocationRefQueryDto } from '../../../common/dto/location-ref.dto';
import { FILTERABLE_PRODUCT_STATUSES } from '../../../common/constants/product-status';

/** The filters `GET /products` and `GET /products/search` share. */
export class ProductFilterDto extends IntersectionType(
  PaginationQueryDto,
  LocationRefQueryDto,
) {
  @IsOptional()
  @IsUUID()
  categoryId?: string;

  /** Products with at least one variant supplied by this supplier. */
  @IsOptional()
  @IsUUID()
  supplierId?: string;

  @IsOptional()
  @IsIn(FILTERABLE_PRODUCT_STATUSES, {
    message: `status phải là ${FILTERABLE_PRODUCT_STATUSES.join(', ')}`,
  })
  status?: string;
}

/** Ported from iKiotMS-BE's ProductQueryDTO. */
export class QueryProductDto extends ProductFilterDto {
  /** Partial, case-insensitive match on the product name. */
  @IsOptional()
  @IsString()
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  search?: string;
}

/**
 * Ported from iKiotMS-BE's ProductSearchQueryDTO — the POS-style lookup, which matches one
 * term against the product name *and* every variant's code/SKU/barcode, and returns the
 * variants inline so a cashier can pick one straight from the result.
 */
export class SearchProductDto extends ProductFilterDto {
  /**
   * At least two characters: a one-character prefix matches most of the catalogue and the
   * result is useless, which is why the old DTO rejected it too.
   */
  @IsOptional()
  @IsString()
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @MinLength(2, { message: 'Từ khoá tìm kiếm phải có ít nhất 2 ký tự' })
  q?: string;
}

/**
 * Ported from `listAllProductItems`. A flat list of variants for pickers that reference a
 * specific SKU — the promotion product picker, an order line. `GET /products` deliberately
 * doesn't attach variants, so this is how callers get SKU-level options.
 */
export class QueryProductItemDto {
  @IsOptional()
  @IsString()
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  search?: string;

  /** Only variants stocked at one of these branches. */
  @IsOptional()
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.split(',').filter(Boolean) : value,
  )
  @IsUUID('4', { each: true })
  branchIds?: string[];

  // Not PaginationQueryDto: this feeds a dropdown, not a table — there is no page, just a
  // ceiling. Same 200/500 default and cap the old service applied.
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(500)
  limit: number = 200;
}
