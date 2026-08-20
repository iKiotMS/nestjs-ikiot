import { PartialType } from '@nestjs/swagger';
import { CreateAttendanceDto } from './create-attendances.dto';

export class UpdateAttendanceDto extends PartialType(CreateAttendanceDto) {}
