import { IsNumber, IsOptional, IsString } from 'class-validator';

export class CreateOrderDto {
  @IsString()
  tenantId: string;

  @IsString()
  branchId: string;

  @IsString()
  customerId: string;

  @IsString()
  status: string;

  @IsString()
  userId: string;

  @IsString()
  paymentMethod: string;

  @IsOptional()
  @IsString()
  paymentReference?: string;

  @IsNumber()
  grandTotal: number;

  @IsOptional()
  @IsNumber()
  customerPay?: number;

  @IsOptional()
  @IsNumber()
  change?: number;

  @IsOptional()
  @IsString()
  note?: string;

  @IsOptional()
  @IsString()
  discountType?: string;

  @IsNumber()
  discountValue: number;
}
