import { PartialType } from '@nestjs/mapped-types';
import { CreateWorkingScheduleDto } from './create-working-schedules.dto';

export class UpdateWorkingScheduleDto extends PartialType(
  CreateWorkingScheduleDto,
) {}
