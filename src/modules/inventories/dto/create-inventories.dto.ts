import { IsInt, IsOptional, IsString } from 'class-validator';

export class CreateInventoryDto {
  @IsString()
  tenantId: string;

  @IsOptional()
  @IsString()
  branchId?: string;

  @IsOptional()
  @IsString()
  warehouseId?: string;

  @IsString()
  productItemId: string;

  @IsInt()
  stock: number;

  @IsInt()
  minStock: number;
}
