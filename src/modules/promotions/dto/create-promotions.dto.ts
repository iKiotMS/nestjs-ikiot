import {
  IsBoolean,
  IsDateString,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
} from 'class-validator';

export class CreatePromotionDto {
  @IsString()
  promoName: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsString()
  discountType: string;

  @IsNumber()
  discountValue: number;

  @IsOptional()
  @IsNumber()
  maxDiscountAmount?: number;

  @IsNumber()
  minOrderValue: number;

  @IsString()
  applicableRuleType: string;

  @IsDateString()
  startDate: string;

  @IsDateString()
  endDate: string;

  @IsBoolean()
  stackable: boolean;

  @IsOptional()
  @IsInt()
  usageLimit?: number;

  @IsOptional()
  @IsInt()
  usageLimitPerCustomer?: number;

  @IsInt()
  usedCount: number;

  @IsString()
  status: string;
}
