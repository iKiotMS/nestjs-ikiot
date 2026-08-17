import { IsNumber, IsOptional, IsString } from 'class-validator';

export class CreatePromotionLogDto {
  @IsString()
  promotionId: string;

  @IsOptional()
  @IsString()
  orderId?: string;

  @IsOptional()
  @IsString()
  branchId?: string;

  @IsOptional()
  @IsString()
  customerId?: string;

  @IsNumber()
  discountAmount: number;

  @IsOptional()
  @IsString()
  description?: string;
}
