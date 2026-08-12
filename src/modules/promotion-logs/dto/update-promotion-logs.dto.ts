import { PartialType } from '@nestjs/mapped-types';
import { CreatePromotionLogDto } from './create-promotion-logs.dto';

export class UpdatePromotionLogDto extends PartialType(CreatePromotionLogDto) {}
