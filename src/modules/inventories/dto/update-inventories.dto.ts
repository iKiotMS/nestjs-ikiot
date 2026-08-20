import { PartialType } from '@nestjs/swagger';
import { CreateInventoryDto } from './create-inventories.dto';

export class UpdateInventoryDto extends PartialType(CreateInventoryDto) {}
