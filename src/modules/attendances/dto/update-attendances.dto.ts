import { PartialType } from '@nestjs/mapped-types';
import { CreateAttendanceDto } from './create-attendances.dto';

export class UpdateAttendanceDto extends PartialType(CreateAttendanceDto) {}
