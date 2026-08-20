import { PartialType } from '@nestjs/swagger';
import { CreateProductItemDto } from './create-product-items.dto';

export class UpdateProductItemDto extends PartialType(CreateProductItemDto) {}
