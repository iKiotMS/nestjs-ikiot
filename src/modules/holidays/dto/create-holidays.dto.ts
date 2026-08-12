import { IsBoolean, IsDateString, IsOptional, IsString } from 'class-validator';

export class CreateHolidayDto {
  @IsString()
  tenantId: string;

  @IsDateString()
  date: string;

  @IsString()
  name: string;

  @IsString()
  type: string;

  @IsOptional()
  @IsString()
  branchId?: string;

  @IsBoolean()
  isActive: boolean;

  @IsString()
  source: string;

  @IsBoolean()
  isManuallyEdited: boolean;
}
