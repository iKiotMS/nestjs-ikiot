import { PartialType } from '@nestjs/swagger';
import { CreateCashDrawerSessionDto } from './create-cash-drawer-sessions.dto';

export class UpdateCashDrawerSessionDto extends PartialType(
  CreateCashDrawerSessionDto,
) {}
