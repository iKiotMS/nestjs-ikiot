import { PartialType } from '@nestjs/swagger';
import { CreateAIChatHistoryDto } from './create-ai-chat-histories.dto';

export class UpdateAIChatHistoryDto extends PartialType(
  CreateAIChatHistoryDto,
) {}
