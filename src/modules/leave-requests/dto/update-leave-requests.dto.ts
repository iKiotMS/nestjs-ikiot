import { PartialType } from '@nestjs/swagger';
import { CreateLeaveRequestDto } from './create-leave-requests.dto';

export class UpdateLeaveRequestDto extends PartialType(CreateLeaveRequestDto) {}
