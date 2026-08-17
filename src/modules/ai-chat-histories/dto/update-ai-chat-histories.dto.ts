import { PartialType } from '@nestjs/mapped-types';
import { CreateAIChatHistoryDto } from './create-ai-chat-histories.dto';

export class UpdateAIChatHistoryDto extends PartialType(
  CreateAIChatHistoryDto,
) {}
