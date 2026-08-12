import { PartialType } from '@nestjs/mapped-types';
import { CreateWarehouseDto } from './create-warehouses.dto';

export class UpdateWarehouseDto extends PartialType(CreateWarehouseDto) {}
