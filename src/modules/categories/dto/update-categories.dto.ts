import { PartialType } from '@nestjs/mapped-types';
import { CreateCategoryDto } from './create-categories.dto';

export class UpdateCategoryDto extends PartialType(CreateCategoryDto) {}
