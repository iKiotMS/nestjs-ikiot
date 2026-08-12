import { IsOptional, IsString } from 'class-validator';

export class CreateCategoryDto {
  @IsString()
  tenantId: string;

  @IsString()
  name: string;

  @IsOptional()
  @IsString()
  parentId?: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsString()
  imageUrl?: string;
}
