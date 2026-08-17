import { IsDateString, IsOptional, IsString } from 'class-validator';

export class CreateShiftTemplateDto {
  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsDateString()
  startTime?: string;

  @IsOptional()
  @IsDateString()
  endTime?: string;

  @IsString()
  status: string;
}
