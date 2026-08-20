import { PartialType } from '@nestjs/swagger';
import { CreateHolidayDto } from './create-holidays.dto';

export class UpdateHolidayDto extends PartialType(CreateHolidayDto) {}
