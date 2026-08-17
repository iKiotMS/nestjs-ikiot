import { IsNumber, IsOptional, IsString } from 'class-validator';

export class CreateProductItemDto {
  @IsString()
  productId: string;

  @IsString()
  productName: string;

  @IsString()
  productCode: string;

  @IsOptional()
  @IsString()
  sku?: string;

  @IsOptional()
  @IsString()
  barcode?: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsNumber()
  retailPrice: number;

  @IsNumber()
  costPrice: number;

  @IsOptional()
  @IsString()
  productSlug?: string;

  @IsOptional()
  @IsString()
  warrantyPeriod?: string;

  @IsOptional()
  @IsNumber()
  vat?: number;
}
