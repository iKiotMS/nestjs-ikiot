import { PartialType } from '@nestjs/mapped-types';
import { CreateCashDrawerSessionDto } from './create-cash-drawer-sessions.dto';

export class UpdateCashDrawerSessionDto extends PartialType(CreateCashDrawerSessionDto) {}
