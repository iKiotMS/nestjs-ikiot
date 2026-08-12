import { PartialType } from '@nestjs/mapped-types';
import { CreateSupplierDto } from './create-suppliers.dto';

export class UpdateSupplierDto extends PartialType(CreateSupplierDto) {}
