import { PartialType } from '@nestjs/swagger';
import { CreateWorkingScheduleDto } from './create-working-schedules.dto';

export class UpdateWorkingScheduleDto extends PartialType(
  CreateWorkingScheduleDto,
) {}
