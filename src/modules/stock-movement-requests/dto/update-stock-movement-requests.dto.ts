import { PartialType } from '@nestjs/mapped-types';
import { CreateStockMovementRequestDto } from './create-stock-movement-requests.dto';

export class UpdateStockMovementRequestDto extends PartialType(
  CreateStockMovementRequestDto,
) {}
