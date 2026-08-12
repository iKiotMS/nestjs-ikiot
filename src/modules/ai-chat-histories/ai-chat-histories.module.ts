import { Module } from '@nestjs/common';
import { AIChatHistoryController } from './ai-chat-histories.controller';
import { AIChatHistoryService } from './ai-chat-histories.service';

@Module({
  controllers: [AIChatHistoryController],
  providers: [AIChatHistoryService],
  exports: [AIChatHistoryService],
})
export class AIChatHistoryModule {}
