import { IsDateString, IsOptional, IsString } from 'class-validator';

export class CreateWorkingScheduleDto {
  @IsString()
  tenantId: string;

  @IsOptional()
  @IsString()
  managedById?: string;

  @IsString()
  scheduleType: string;

  @IsOptional()
  @IsString()
  shiftTemplateId?: string;

  @IsOptional()
  @IsString()
  createdById?: string;

  @IsOptional()
  @IsDateString()
  workDate?: string;

  @IsOptional()
  @IsDateString()
  startAt?: string;

  @IsOptional()
  @IsDateString()
  endAt?: string;

  @IsString()
  status: string;
}
