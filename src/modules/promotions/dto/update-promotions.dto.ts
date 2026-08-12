import { PartialType } from '@nestjs/mapped-types';
import { CreatePromotionDto } from './create-promotions.dto';

export class UpdatePromotionDto extends PartialType(CreatePromotionDto) {}
