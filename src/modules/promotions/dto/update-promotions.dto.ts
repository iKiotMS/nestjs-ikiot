import { PartialType } from '@nestjs/swagger';
import { CreatePromotionDto } from './create-promotions.dto';

export class UpdatePromotionDto extends PartialType(CreatePromotionDto) {}
