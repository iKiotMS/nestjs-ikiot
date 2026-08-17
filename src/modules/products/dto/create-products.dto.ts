import { IsOptional, IsString } from 'class-validator';

export class CreateProductDto {
  @IsOptional()
  @IsString()
  brandId?: string;

  @IsOptional()
  @IsString()
  categoryId?: string;

  @IsString()
  name: string;

  @IsString()
  status: string;

  @IsOptional()
  @IsString()
  categoryName?: string;
}
