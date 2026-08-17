import { IsDateString, IsOptional, IsString } from 'class-validator';

export class CreateWorkingScheduleDto {
  @IsOptional()
  @IsString()
  managedById?: string;

  @IsString()
  scheduleType: string;

  @IsOptional()
  @IsString()
  shiftTemplateId?: string;

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
