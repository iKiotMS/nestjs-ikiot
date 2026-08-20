import { PartialType } from '@nestjs/swagger';
import { CreateStockMovementRequestDto } from './create-stock-movement-requests.dto';

export class UpdateStockMovementRequestDto extends PartialType(
  CreateStockMovementRequestDto,
) {}
