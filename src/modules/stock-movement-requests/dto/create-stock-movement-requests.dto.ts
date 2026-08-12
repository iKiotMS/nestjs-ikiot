import { IsNumber, IsOptional, IsString } from 'class-validator';

export class CreateStockMovementRequestDto {
  @IsString()
  tenantId: string;

  @IsString()
  movementType: string;

  @IsString()
  status: string;

  @IsOptional()
  @IsString()
  fromSupplierId?: string;

  @IsOptional()
  @IsString()
  fromBranchId?: string;

  @IsOptional()
  @IsString()
  fromWarehouseId?: string;

  @IsOptional()
  @IsString()
  toBranchId?: string;

  @IsOptional()
  @IsString()
  toWarehouseId?: string;

  @IsString()
  createdById: string;

  @IsNumber()
  totalPrice: number;

  @IsOptional()
  @IsString()
  note?: string;
}
