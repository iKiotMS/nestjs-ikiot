import { IsArray, IsBoolean, IsInt, IsNumber, IsString } from 'class-validator';

export class CreatePlanDto {
  @IsString()
  planName: string;

  @IsString()
  planCode: string;

  @IsNumber()
  price: number;

  @IsString()
  billingCycle: string;

  @IsInt()
  maxBranches: number;

  @IsInt()
  maxUsers: number;

  @IsInt()
  maxProducts: number;

  @IsInt()
  trialDays: number;

  @IsArray()
  @IsString({ each: true })
  features: string[];

  @IsString()
  description: string;

  @IsArray()
  @IsString({ each: true })
  displayFeatures: string[];

  @IsBoolean()
  isPopular: boolean;

  @IsBoolean()
  isActive: boolean;
}
