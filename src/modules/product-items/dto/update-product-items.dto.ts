import { PartialType } from '@nestjs/mapped-types';
import { CreateProductItemDto } from './create-product-items.dto';

export class UpdateProductItemDto extends PartialType(CreateProductItemDto) {}
