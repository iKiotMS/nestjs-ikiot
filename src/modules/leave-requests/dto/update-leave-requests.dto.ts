import { PartialType } from '@nestjs/mapped-types';
import { CreateLeaveRequestDto } from './create-leave-requests.dto';

export class UpdateLeaveRequestDto extends PartialType(CreateLeaveRequestDto) {}
