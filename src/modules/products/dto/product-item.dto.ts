import { Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';
import { LocationRefDto } from '../../../common/dto/location-ref.dto';

/** One image on a product or a variant. Mongo stored these inline; Postgres splits them
 *  into a child table, but the API keeps the same array of objects. */
export class ProductImageDto {
  @IsString()
  @IsNotEmpty({ message: 'Ảnh phải có url' })
  url: string;

  @IsOptional()
  @IsBoolean()
  isThumbnail?: boolean;
}

/** One spec row on a variant ("Màu" / "Đỏ"). `productDetails` in the old API. */
export class ProductItemDetailDto {
  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsString()
  value?: string;
}

/** Opening stock for a variant, at one location. */
export class InitialStockDto extends LocationRefDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0, { message: 'Tồn kho ban đầu không được âm' })
  stock?: number;
}

/**
 * A variant (ProductItem / SKU). Ported from iKiotMS-BE's CreateProductItemRequestDTO,
 * which is also what CreateProductRequestDTO validated its `items[]` against by hand —
 * the old code duplicated those checks in both files and they had already diverged
 * (`initialStock` was validated in one and ignored in the other).
 */
export class CreateProductItemDto {
  @IsString()
  @IsNotEmpty({ message: 'Tên mặt hàng không được để trống' })
  productName: string;

  @IsString()
  @IsNotEmpty({ message: 'Mã mặt hàng không được để trống' })
  productCode: string;

  @IsString()
  @IsNotEmpty({ message: 'SKU không được để trống' })
  sku: string;

  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0, { message: 'Giá bán không được âm' })
  retailPrice: number;

  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0, { message: 'Giá vốn không được âm' })
  costPrice: number;

  @IsOptional()
  @IsString()
  barcode?: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsString()
  warrantyPeriod?: string;

  /** Percent, 0–100. Spelled `VAT` in the old API; the column is `vat`. */
  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(100, { message: 'VAT phải trong khoảng 0–100' })
  vat?: number;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ProductItemDetailDto)
  productDetails?: ProductItemDetailDto[];

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ProductImageDto)
  images?: ProductImageDto[];

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => InitialStockDto)
  initialStock?: InitialStockDto[];

  /** Suppliers this variant can be bought from. New here: the old API only allowed
   *  attaching a supplier afterwards, via POST /products/items/:itemId/suppliers. */
  @IsOptional()
  @IsArray()
  @IsUUID('4', { each: true })
  supplierIds?: string[];
}
