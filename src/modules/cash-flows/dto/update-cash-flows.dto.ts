import { PartialType } from '@nestjs/swagger';
import { CreateCashFlowDto } from './create-cash-flows.dto';

export class UpdateCashFlowDto extends PartialType(CreateCashFlowDto) {}
