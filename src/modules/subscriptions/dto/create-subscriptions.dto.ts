import { IsBoolean, IsDateString, IsInt, IsOptional, IsString } from 'class-validator';

export class CreateSubscriptionDto {
  @IsString()
  tenantId: string;

  @IsString()
  planId: string;

  @IsString()
  status: string;

  @IsDateString()
  startDate: string;

  @IsDateString()
  endDate: string;

  @IsOptional()
  @IsDateString()
  trialEndDate?: string;

  @IsBoolean()
  autoRenew: boolean;

  @IsOptional()
  @IsDateString()
  cancelledAt?: string;

  @IsOptional()
  @IsString()
  cancelReason?: string;

  @IsOptional()
  @IsInt()
  quotaSnapshotMaxBranches?: number;

  @IsOptional()
  @IsInt()
  quotaSnapshotMaxUsers?: number;

  @IsOptional()
  @IsInt()
  quotaSnapshotMaxProducts?: number;
}
