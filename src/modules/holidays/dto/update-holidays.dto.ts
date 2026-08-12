import { PartialType } from '@nestjs/mapped-types';
import { CreateHolidayDto } from './create-holidays.dto';

export class UpdateHolidayDto extends PartialType(CreateHolidayDto) {}
