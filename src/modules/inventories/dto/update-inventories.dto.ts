import { PartialType } from '@nestjs/mapped-types';
import { CreateInventoryDto } from './create-inventories.dto';

export class UpdateInventoryDto extends PartialType(CreateInventoryDto) {}
