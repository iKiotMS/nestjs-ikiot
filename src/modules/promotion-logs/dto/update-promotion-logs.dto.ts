import { PartialType } from '@nestjs/swagger';
import { CreatePromotionLogDto } from './create-promotion-logs.dto';

export class UpdatePromotionLogDto extends PartialType(CreatePromotionLogDto) {}
