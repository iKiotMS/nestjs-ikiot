import { PartialType } from '@nestjs/mapped-types';
import { CreateCashFlowDto } from './create-cash-flows.dto';

export class UpdateCashFlowDto extends PartialType(CreateCashFlowDto) {}
