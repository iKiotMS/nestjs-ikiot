import { PartialType } from '@nestjs/mapped-types';
import { CreateBrandDto } from './create-brands.dto';

export class UpdateBrandDto extends PartialType(CreateBrandDto) {}
