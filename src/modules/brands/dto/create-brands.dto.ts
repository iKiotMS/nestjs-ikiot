import { IsOptional, IsString } from 'class-validator';

export class CreateBrandDto {
  @IsString()
  tenantId: string;

  @IsString()
  name: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsString()
  logo?: string;
}
